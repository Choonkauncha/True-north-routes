/** Group paperwork by property. No network calls. */

function looseKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export const DOC_TYPES = Object.freeze([
  ['all', 'All'],
  ['inspection', 'Inspection'],
  ['intake', 'Setter intake'],
  ['contingency', 'Contingency'],
  ['closing', 'Closing'],
  ['upload', 'Uploaded'],
  ['photo', 'Roof photo'],
  ['form', 'Other form']
]);

const TYPE_LABEL = Object.fromEntries(DOC_TYPES);

export function typeLabel(type) {
  return TYPE_LABEL[type] || 'Form';
}

export function formDocType(templateName, kind) {
  const name = String(templateName || '').toLowerCase();
  if (name.includes('contingency')) return 'contingency';
  if (name.includes('closing') || name.includes('deal')) return 'closing';
  if (name.includes('inspection')) return 'inspection';
  if (kind === 'file') return 'upload';
  return 'form';
}

export function easternDay(iso, timeZone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(iso));
}

function easternWeekdayIndex(date, timeZone = 'America/New_York') {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  return { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[weekday] ?? 0;
}

function shiftDay(ymd, days) {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function easternWeekStart(now = new Date()) {
  return shiftDay(easternDay(now), -easternWeekdayIndex(now));
}

/** Today, the rest of this Eastern week, or older. */
export function dateSection(iso, now = new Date()) {
  const day = easternDay(iso);
  const today = easternDay(now);
  if (day === today) return 'today';
  const start = easternWeekStart(now);
  if (day >= start && day < today) return 'week';
  return 'older';
}

export function formatWhen(iso) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function personFrom(reps, id, fallbackName) {
  const found = (reps || []).find((rep) => rep.id === id);
  return {
    personId: id || '',
    personName: found?.name || fallbackName || '',
    personRole: found?.role || ''
  };
}

function intakeAddress(row) {
  return [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
}

export function collectDocuments({ submissions = [], photos = [], intakes = [], reps = [], templates = [] } = {}) {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const docs = [];
  for (const row of submissions) {
    const template = templateById.get(row.template_id);
    const person = personFrom(reps, row.submitted_by, row.rep_name || row.submitter?.name);
    docs.push({
      id: `form:${row.id}`,
      source: 'form',
      sourceId: row.id,
      type: formDocType(row.template_name, template?.kind || row.kind),
      title: row.template_name || 'Form',
      homeowner: row.homeowner_name || '',
      address: row.address_snapshot || '',
      ...person,
      at: row.created_at || '',
      reviewed: Boolean(row.reviewed_at),
      note: '',
      href: row.id ? `/form-print.html?id=${encodeURIComponent(row.id)}` : '',
      image: ''
    });
  }
  for (const row of photos) {
    const person = personFrom(reps, row.uploaded_by, row.uploader_name || row.uploader?.name);
    docs.push({
      id: `photo:${row.id}`,
      source: 'photo',
      sourceId: row.id,
      type: 'photo',
      title: 'Roof photo',
      homeowner: '',
      address: row.address_snapshot || '',
      ...person,
      at: row.created_at || '',
      reviewed: Boolean(row.reviewed_at),
      note: row.caption || '',
      href: row.url || '',
      image: row.url || ''
    });
  }
  for (const row of intakes) {
    const person = personFrom(reps, row.created_by, row.creator?.name);
    const publicRequest = row.source === 'public_homeowner_form';
    docs.push({
      id: `intake:${row.id}`,
      source: 'intake',
      sourceId: row.id,
      type: publicRequest ? 'inspection' : 'intake',
      title: publicRequest ? 'Inspection request' : 'Setter intake',
      homeowner: [row.first_name, row.last_name].filter(Boolean).join(' '),
      address: intakeAddress(row),
      ...person,
      at: row.created_at || '',
      reviewed: Boolean(row.reviewed_at),
      note: row.notes || row.concern || '',
      href: '',
      image: ''
    });
  }
  const homeownerByProperty = new Map();
  for (const doc of docs) {
    const key = propertyKey(doc);
    if (doc.homeowner && !homeownerByProperty.has(key)) homeownerByProperty.set(key, doc.homeowner);
  }
  return docs.map((doc) => (
    doc.homeowner ? doc : { ...doc, homeowner: homeownerByProperty.get(propertyKey(doc)) || '' }
  )).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function matchesDocumentQuery(doc, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [doc.homeowner, doc.address, doc.personName, doc.title].join(' ').toLowerCase().includes(needle);
}

export function visibleDocuments(docs, filters = {}) {
  const type = filters.type || 'all';
  const status = filters.status || 'all';
  return (docs || []).filter((doc) => {
    if (type !== 'all' && doc.type !== type) return false;
    if (filters.personId && doc.personId !== filters.personId) return false;
    if (status === 'new' && doc.reviewed) return false;
    if (status === 'reviewed' && !doc.reviewed) return false;
    return matchesDocumentQuery(doc, filters.query);
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function propertyKey(doc) {
  return looseKey(doc.address) || looseKey(doc.homeowner) || 'unassigned';
}

export function propertyGroups(docs) {
  const groups = new Map();
  for (const doc of docs || []) {
    const key = propertyKey(doc);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        address: doc.address || 'No address yet',
        homeowner: doc.homeowner || '',
        docs: []
      });
    }
    const group = groups.get(key);
    group.docs.push(doc);
    if (!group.homeowner && doc.homeowner) group.homeowner = doc.homeowner;
    if ((!group.address || group.address === 'No address yet') && doc.address) group.address = doc.address;
  }
  return [...groups.values()].map((group) => {
    group.docs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    group.latest = group.docs[0]?.at || '';
    group.newCount = group.docs.filter((doc) => !doc.reviewed).length;
    return group;
  }).sort((a, b) => String(b.latest).localeCompare(String(a.latest)));
}

export function sectionGroups(groups, now = new Date()) {
  const sections = [
    { id: 'today', label: 'Today', groups: [] },
    { id: 'week', label: 'This week', groups: [] },
    { id: 'older', label: 'Older', groups: [] }
  ];
  for (const group of groups || []) {
    const section = sections.find((item) => item.id === dateSection(group.latest, now));
    section.groups.push(group);
  }
  return sections.filter((section) => section.groups.length);
}

export function sectionDocuments(docs, now = new Date()) {
  const sections = [
    { id: 'today', label: 'Today', docs: [] },
    { id: 'week', label: 'This week', docs: [] },
    { id: 'older', label: 'Older', docs: [] }
  ];
  for (const doc of docs || []) {
    const section = sections.find((item) => item.id === dateSection(doc.at, now));
    section.docs.push(doc);
  }
  return sections.filter((section) => section.docs.length);
}
