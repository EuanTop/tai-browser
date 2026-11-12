// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
#include "sidebar_browser/host/local_host_server.h"
#include <unistd.h>
#include <map>
#include "base/files/scoped_temp_dir.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/weak_ptr.h"
#include "base/threading/sequence_bound.h"
#include "base/threading/thread.h"
#include "base/task/bind_post_task.h"
#include "base/timer/timer.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
namespace sidebar {
namespace {
constexpr size_t kMaxRequest = 8 * 1024 * 1024;
constexpr size_t kMaxResponse = 16 * 1024 * 1024;
constexpr auto kTraffic = net::DefineNetworkTrafficAnnotation("tai_local_component_host", R"(
 semantics { sender: "TAi local component host" description: "A same-user Unix socket serves explicitly authorized browser tasks." trigger: "User creates a connection in TAi settings." data: "Scoped browser operation requests and results; no browser cookies or account credentials." destination: LOCAL }
 policy { cookies_allowed: NO setting: "User may revoke the task in TAi settings; no TCP listener exists." policy_exception_justification: "This is a local user-authorized development feature." })");
class SocketServer {
 public:
  explicit SocketServer(LocalHostServer::Dispatch dispatch) : dispatch_(std::move(dispatch)) {}
  std::string Listen() {
    if (!directory_.CreateUniqueTempDirUnderPath(base::FilePath("/tmp"), "tai-host-")) return {};
    const auto path = directory_.GetPath().AppendASCII("s");
    server_ = std::make_unique<net::UnixDomainServerSocket>(base::BindRepeating(
        [](const net::UnixDomainServerSocket::Credentials& credentials) {
          return credentials.user_id == getuid();
        }), false);
    if (server_->BindAndListen(path.value(), 16) != net::OK) return {};
    Accept(); return path.value();
  }
 private:
  struct Connection {
    std::unique_ptr<net::StreamSocket> socket;
    scoped_refptr<net::IOBufferWithSize> input = base::MakeRefCounted<net::IOBufferWithSize>(8192);
    scoped_refptr<net::DrainableIOBuffer> output;
    std::string text;
    base::OneShotTimer deadline;
  };
  void Accept() {
    int result = server_->Accept(&accepted_, base::BindOnce(&SocketServer::Accepted, weak_.GetWeakPtr()));
    if (result != net::ERR_IO_PENDING) Accepted(result);
  }
  void Accepted(int result) {
    if (result == net::OK && accepted_) {
      if (connections_.size() < 32) {
        int id = ++next_;
        auto connection = std::make_unique<Connection>();
        connection->socket = std::move(accepted_);
        connection->deadline.Start(FROM_HERE, base::Seconds(30), base::BindOnce(
            &SocketServer::Close, weak_.GetWeakPtr(), id));
        connections_.emplace(id, std::move(connection));
        Read(id);
      } else accepted_.reset();
    }
    if (result == net::OK) base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&SocketServer::Accept, weak_.GetWeakPtr()));
  }
  void Close(int id) { connections_.erase(id); }
  void Read(int id) {
    const auto found = connections_.find(id);
    if (found == connections_.end()) return;
    auto& connection = *found->second;
    int result = connection.socket->Read(connection.input.get(), connection.input->size(),
        base::BindOnce(&SocketServer::ReadDone, weak_.GetWeakPtr(), id));
    if (result != net::ERR_IO_PENDING) ReadDone(id, result);
  }
  void ReadDone(int id, int result) {
    auto found = connections_.find(id);
    if (found == connections_.end()) return;
    auto& connection = *found->second;
    if (result <= 0) { Close(id); return; }
    connection.text.append(connection.input->data(), result);
    if (connection.text.size() > kMaxRequest) { Close(id); return; }
    const auto newline = connection.text.find('\n');
    if (newline == std::string::npos) {
      base::SequencedTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
          base::BindOnce(&SocketServer::Read, weak_.GetWeakPtr(), id));
      return;
    }
    if (newline + 1 != connection.text.size()) { Close(id); return; }
    auto envelope = base::JSONReader::Read(connection.text, base::JSON_PARSE_RFC);
    if (!envelope || !envelope->is_dict() || envelope->GetDict().size() != 2) { Close(id); return; }
    const auto* token = envelope->GetDict().FindString("token");
    auto* request = envelope->GetDict().Find("request");
    if (!token || token->size() != 64 || !request) { Close(id); return; }
    dispatch_.Run(*token, request->Clone(), base::BindPostTaskToCurrentDefault(
        base::BindOnce(&SocketServer::Respond, weak_.GetWeakPtr(), id)));
  }
  void Respond(int id, base::DictValue result) {
    auto found = connections_.find(id); if (found == connections_.end()) return;
    auto json = base::WriteJson(result);
    if (!json || json->size() > kMaxResponse) { Close(id); return; }
    json->push_back('\n');
    auto bytes = base::MakeRefCounted<net::StringIOBuffer>(std::move(*json));
    found->second->output = base::MakeRefCounted<net::DrainableIOBuffer>(bytes, bytes->size());
    Write(id);
  }
  void Write(int id) {
    const auto found = connections_.find(id);
    if (found == connections_.end()) return;
    auto& connection = *found->second;
    int result = connection.socket->Write(connection.output.get(), connection.output->BytesRemaining(),
        base::BindOnce(&SocketServer::WriteDone, weak_.GetWeakPtr(), id), kTraffic);
    if (result != net::ERR_IO_PENDING) WriteDone(id, result);
  }
  void WriteDone(int id, int result) {
    auto found = connections_.find(id); if (found == connections_.end()) return;
    if (result <= 0) { Close(id); return; }
    found->second->output->DidConsume(result);
    if (!found->second->output->BytesRemaining()) { Close(id); return; }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
        base::BindOnce(&SocketServer::Write, weak_.GetWeakPtr(), id));
  }
  LocalHostServer::Dispatch dispatch_;
  base::ScopedTempDir directory_;
  std::unique_ptr<net::UnixDomainServerSocket> server_;
  std::unique_ptr<net::StreamSocket> accepted_;
  std::map<int, std::unique_ptr<Connection>> connections_;
  int next_ = 0;
  base::WeakPtrFactory<SocketServer> weak_{this};
};
}
struct LocalHostServer::Impl {
  base::Thread thread{"TAi local IPC"};
  base::SequenceBound<SocketServer> server;
};
LocalHostServer::LocalHostServer(Dispatch dispatch, base::OnceCallback<void(std::string)> ready)
    : impl_(std::make_unique<Impl>()) {
  base::Thread::Options options; options.message_pump_type = base::MessagePumpType::IO;
  if (!impl_->thread.StartWithOptions(std::move(options))) { std::move(ready).Run({}); return; }
  impl_->server = base::SequenceBound<SocketServer>(impl_->thread.task_runner(),
      base::BindPostTaskToCurrentDefault(std::move(dispatch)));
  impl_->server.AsyncCall(&SocketServer::Listen).Then(std::move(ready));
}
LocalHostServer::~LocalHostServer() {
  impl_->server.Reset();
  impl_->thread.Stop();
}
}
