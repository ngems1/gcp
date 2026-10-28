// DOM helpers. All user data goes in through textContent / attributes,
// never through innerHTML, so it can't be interpreted as markup.

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function setOptions(select, options, { placeholder } = {}) {
  select.replaceChildren();
  if (placeholder !== undefined) select.append(h('option', { value: '', text: placeholder }));
  for (const { value, label } of options) select.append(h('option', { value, text: label }));
}

export const STATUS_LABELS = { active: 'Active', on_leave: 'On leave', inactive: 'Inactive' };
