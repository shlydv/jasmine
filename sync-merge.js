// Three-way reconciliation: local edits win conflicts; unrelated cloud records survive.
(function(root) {
  const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function keyed(items,kind) {
    const map=new Map(),counts=new Map();
    for(const item of items||[]) {
      let key;
      if(kind==='tenants') {
        const flat=String(item.flat||'');const n=counts.get(flat)||0;counts.set(flat,n+1);
        key=item.tenantId||flat+'#'+n;
      } else if(kind==='entries')key=item.month||String(item.id);
      else if(object(item))key=String(item.id||item.name);
      else key=JSON.stringify(item);
      map.set(key,item);
    }
    return map;
  }
  function merge(base,local,remote,kind='') {
    if(equal(local,base))return copy(remote);
    if(equal(remote,base)||equal(local,remote))return copy(local);
    // A bill is one coherent calculation. Keep the locally edited bill intact.
    if(kind==='bill')return copy(local);
    if(Array.isArray(local)&&Array.isArray(remote)) {
      if(!['tenants','entries','financeRecords','documents','meters','flats'].includes(kind))return copy(local);
      const b=keyed(Array.isArray(base)?base:[],kind),l=keyed(local,kind),r=keyed(remote,kind),result=[];
      for(const key of new Set([...l.keys(),...r.keys()])) {
        const value=merge(b.get(key),l.get(key),r.get(key),kind==='entries'?'bill':'');
        if(value!==undefined)result.push(value);
      }
      return result;
    }
    if(object(local)&&object(remote)) {
      const result={};
      for(const key of new Set([...Object.keys(local),...Object.keys(remote)])) {
        if(['__proto__','constructor','prototype'].includes(key))continue;
        const value=merge(object(base)?base[key]:undefined,local[key],remote[key],key);
        if(value!==undefined)result[key]=value;
      }
      return result;
    }
    return copy(local);
  }
  root.mergeLocalEdits=merge;
  if(typeof module!=='undefined')module.exports={mergeLocalEdits:merge};
})(typeof globalThis!=='undefined'?globalThis:this);
