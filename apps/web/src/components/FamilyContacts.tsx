export type FamilyContact={id:string;displayName:string;role:'admin'|'member';status:string};

export function FamilyContacts({members,currentMemberId}:{members:FamilyContact[];currentMemberId:string}){
  const active=members.filter(member=>member.status==='active');
  return <section className="panel contacts-panel"><h2>Контакты</h2><div className="contacts-list">{active.map(member=><div className="contact-row" key={member.id}><div className="contact-avatar" aria-hidden="true">{member.displayName.trim().slice(0,1).toUpperCase()||'•'}</div><div className="contact-copy"><strong>{member.displayName}</strong><span>{member.id===currentMemberId?'Вы':member.role==='admin'?'Администратор':'Член семьи'}</span></div></div>)}</div></section>;
}
