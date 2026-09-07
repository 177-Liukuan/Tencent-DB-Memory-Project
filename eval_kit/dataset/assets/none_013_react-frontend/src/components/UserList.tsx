import {useMemo, useState} from 'react';

export interface UserSummary { id:string; name:string; email:string; status:'active'|'disabled' }
export interface UserListProps { users:UserSummary[]; onSelect:(user:UserSummary)=>void }

function normalizeQuery(value:string):string { return value.trim().toLocaleLowerCase(); }
function matches(user:UserSummary, query:string):boolean {
  if(!query) return true;
  return user.name.toLocaleLowerCase().includes(query)||user.email.toLocaleLowerCase().includes(query);
}

export function UserList({users,onSelect}:UserListProps){
  const [query,setQuery]=useState('');
  const [status,setStatus]=useState<'all'|'active'|'disabled'>('all');
  const normalized=normalizeQuery(query);
  const visible=useMemo(()=>users.filter(user=>matches(user,normalized)&&(status==='all'||user.status===status)),[users,normalized,status]);
  return <section aria-labelledby="users-heading">
    <h2 id="users-heading">Users</h2>
    <label htmlFor="user-search">Search users</label>
    <input id="user-search" value={query} onChange={e=>setQuery(e.target.value)} />
    <label htmlFor="status-filter">Status</label>
    <select id="status-filter" value={status} onChange={e=>setStatus(e.target.value as typeof status)}>
      <option value="all">All</option><option value="active">Active</option><option value="disabled">Disabled</option>
    </select>
    <p aria-live="polite">{visible.length} users</p>
    <ul>{visible.map(user=><li key={user.id}><button type="button" onClick={()=>onSelect(user)}>
      <span>{user.name}</span><span>{user.email}</span><span>{user.status}</span>
    </button></li>)}</ul>
  </section>;
}

export function stableUserSort(users:UserSummary[]):UserSummary[]{
  return users.map((user,index)=>({user,index})).sort((a,b)=>a.user.name.localeCompare(b.user.name)||a.index-b.index).map(x=>x.user);
}

export function mergeUser(current:UserSummary[], update:UserSummary):UserSummary[]{
  const index=current.findIndex(user=>user.id===update.id);
  if(index<0) return [...current,update];
  return current.map((user,i)=>i===index?update:user);
}
