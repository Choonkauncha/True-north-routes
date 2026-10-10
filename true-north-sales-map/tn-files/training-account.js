import { canViewItem, isHighlighted } from '../lib/training-progress.js';
import { accountHtml } from './training-ui.js';

export async function mountAccountTraining(host, ctx) {
  if (!host || !ctx?.sb || !ctx.rep) return;
  host.innerHTML = '<p class="tnHelp">Loading training status…</p>';
  const [items, progress, reminders, assignments] = await Promise.all([
    ctx.sb.from('training_items').select('id,title,description,kind,audience,required,active,sort_order,duration_seconds,slide_count,page_count,external_provider').eq('active', true).order('sort_order'),
    ctx.sb.from('training_progress').select('*').eq('rep_id', ctx.rep.id),
    ctx.sb.from('training_reminders').select('item_id,rep_id').eq('rep_id', ctx.rep.id),
    ctx.sb.from('training_assignments').select('item_id,rep_id').eq('rep_id', ctx.rep.id)
  ]);
  if ([items, progress, reminders, assignments].some(result => result.error)) {
    host.replaceChildren();
    const notice = document.createElement('p');
    notice.className = 'tnHelp'; notice.setAttribute('role', 'status');
    notice.textContent = 'Your training status is unavailable. Open Training to refresh your lessons and saved progress.';
    host.append(notice);
    return;
  }
  const assigned = new Set((assignments.data || []).map((row) => row.item_id));
  const rows = (items.data || [])
    .map((item) => ({
      ...item,
      assigneeIds: assigned.has(item.id) ? [ctx.rep.id] : [],
      progress: (progress.data || []).find((row) => row.item_id === item.id) || null,
      reminded: isHighlighted(item, reminders.data || [], ctx.rep.id) && !item.required
    }))
    .filter((item) => canViewItem(item, ctx.rep.role, ctx.rep.id));
  host.innerHTML = accountHtml(rows);
}
