const state={orders:[],status:'idle',selected:null};
function byTestId(id){return document.querySelector(`[data-testid="${id}"]`);}
function setStatus(text){const node=byTestId('orders-status');if(node)node.textContent=text;}
function render(){
  const table=byTestId('orders-body'); if(!table)return; table.replaceChildren();
  for(const order of state.orders){
    const row=document.createElement('tr'); row.dataset.orderId=order.id;
    const id=document.createElement('td');id.textContent=order.id;
    const total=document.createElement('td');total.textContent=`$${(order.totalCents/100).toFixed(2)}`;
    const action=document.createElement('td');const button=document.createElement('button');button.textContent='Open';button.setAttribute('aria-label',`Open order ${order.id}`);button.onclick=()=>select(order.id);action.append(button);
    row.append(id,total,action);table.append(row);
  }
}
function select(id){state.selected=state.orders.find(order=>order.id===id)??null;const target=byTestId('selected-order');if(target)target.textContent=state.selected?JSON.stringify(state.selected):'No selection';}
async function loadOrders(fetcher=fetch){
  state.status='loading';setStatus('Loading orders');
  try{const response=await fetcher('/api/orders');if(!response.ok)throw new Error(`HTTP ${response.status}`);const payload=await response.json();state.orders=Array.isArray(payload.orders)?payload.orders:[];state.status='ready';render();setStatus(`${state.orders.length} orders`);}
  catch(error){state.status='error';setStatus(error instanceof Error?error.message:'Unable to load orders');}
}
export function normalizeOrder(raw){if(!raw||typeof raw!=='object')throw new Error('order object required');const id=String(raw.id??'').trim();const totalCents=Number(raw.totalCents);if(!id||!Number.isInteger(totalCents)||totalCents<0)throw new Error('invalid order');return{id,totalCents};}
export function sortOrders(rows){return [...rows].sort((a,b)=>a.id.localeCompare(b.id));}
if(typeof document!=='undefined')loadOrders();
