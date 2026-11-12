import Defuddle from 'defuddle';
import TurndownService from 'turndown';
import {gfm} from 'turndown-plugin-gfm';
import * as VirtualDOM from 'linkedom/worker';
const {parseHTML,HTMLElement}=VirtualDOM;
// LinkeDOM intentionally omits this browser convenience getter. GFM needs it
// even when Turndown clones virtual nodes; never patch a native DOM prototype.
if(!Object.getOwnPropertyDescriptor(HTMLElement.prototype,'rows'))Object.defineProperty(HTMLElement.prototype,'rows',{get(){return [...this.querySelectorAll('tr')].filter(row=>row.closest('table')===this);}});
import {createCapture} from './capture.mjs';

// Virtual DOM only: snapshots never enter a WebUI document or native DOMParser.
// Defuddle extracts HTML; Turndown receives a virtual DOM node, avoiding its
// string parser's dependency on window.document / a Trusted Types bypass.
function inertDocument(document,url){
  // LinkeDOM's defaultView is a Proxy over globalThis. Assigning to it would
  // overwrite the host's getComputedStyle. Keep a per-document inert facade,
  // including on the clones made internally by Defuddle.
  const view={...VirtualDOM,document,getComputedStyle:()=>({display:''})};
  view.window=view;Object.freeze(view);
  Object.defineProperty(document,'defaultView',{value:view});
  const clone=document.cloneNode.bind(document);
  Object.defineProperty(document,'cloneNode',{value:deep=>inertDocument(clone(deep),url)});
  document.URL=url;document.styleSheets=[];return document;
}
export const captureSnapshot = createCapture({
  createDocument(html,url){return{document:inertDocument(parseHTML(html).document,url),close(){}};},
  extract(doc,url,options){
    const extracted=new Defuddle(doc,{...options,url,markdown:false,separateMarkdown:false}).parse();
    const {document}=parseHTML('<!doctype html><html><body></body></html>');
    document.body.innerHTML=extracted.content;
    for(const table of document.querySelectorAll('table'))if(!table.rows.length)table.remove();
    for(const container of document.querySelectorAll('table,thead,tbody,tfoot,tr'))for(const node of [...container.childNodes])if(node.nodeType===3&&!node.textContent.trim())node.remove();
    const converter=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-',preformattedCode:true});
    converter.use(gfm);
    converter.remove(['script','style','iframe','object','embed','input','textarea','select']);
    converter.addRule('latex-source',{
      filter:node=>node.hasAttribute('data-latex')&&!!node.getAttribute('data-latex').trim(),
      replacement:(_content,node)=>{const latex=node.getAttribute('data-latex').trim();return node.getAttribute('display')==='block'||node.classList.contains('math-display')?'\n\n$$\n'+latex+'\n$$\n\n':'$'+latex+'$';},
    });
    return{...extracted,content:converter.turndown(document.body)};
  },
});
export {settings} from './capture.mjs';
