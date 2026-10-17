// Display-only text helpers. Stored values are never changed.
const KEEP_UPPER=new Set(['N','S','E','W','NE','NW','SE','SW','OH','PO','LLC','II','III','IV','USA','US','TWP']);
// Converts ALL-CAPS names and addresses ("1272 CITY PARK AVE", "O'BRIEN") to Title Case.
// Mixed-case text is returned untouched, so hand-typed names keep their own capitalization.
export function titleCase(value){
 const text=String(value??'');
 if(!/[A-Z]/.test(text)||/[a-z]/.test(text))return text;
 return text.toLowerCase().replace(/[a-z0-9]+(?:'[a-z]+)?/g,(word,offset,all)=>{
  const upper=word.toUpperCase();
  if(KEEP_UPPER.has(upper))return upper;
  if(/^\d+(st|nd|rd|th)$/.test(word))return word;
  if(/^\d/.test(word))return upper;
  let out=word.charAt(0).toUpperCase()+word.slice(1);
  out=out.replace(/^Mc([a-z])/,(m,c)=>'Mc'+c.toUpperCase()).replace(/^O'([a-z])/,(m,c)=>"O'"+c.toUpperCase());
  return out;
 }).replace(/-([a-z])/g,(m,c)=>'-'+c.toUpperCase());
}
// Lead statuses keep their stored names; only what people read changes.
export const STATUS_LABELS={Appointment:'Inspection'};
export const statusLabel=status=>STATUS_LABELS[status]||status;
