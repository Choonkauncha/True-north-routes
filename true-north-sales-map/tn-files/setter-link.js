const lead = new URLSearchParams(location.search).get('lead');
const link = document.getElementById('fillFormLink');
if (link && lead) link.href = `/forms.html?lead=${encodeURIComponent(lead)}`;
