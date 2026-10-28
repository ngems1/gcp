'use strict';

const DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations', 'Support'];
const STATUSES = ['active', 'on_leave', 'inactive'];
const FIELDS = ['firstName', 'lastName', 'email', 'department', 'role', 'hireDate', 'status'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function checkName(label, v, max) {
  if (typeof v !== 'string') return `${label} is required`;
  const t = v.trim();
  if (t.length < 1) return `${label} is required`;
  if (t.length > max) return `${label} must be at most ${max} characters`;
  return null;
}

const RULES = {
  firstName: (v) => checkName('First name', v, 60),
  lastName: (v) => checkName('Last name', v, 60),
  role: (v) => checkName('Role', v, 80),
  email: (v) => {
    if (typeof v !== 'string' || !v.trim()) return 'Email is required';
    const t = v.trim();
    if (t.length > 254 || !EMAIL_RE.test(t)) return 'Email must be a valid address';
    return null;
  },
  department: (v) =>
    DEPARTMENTS.includes(v) ? null : `Department must be one of: ${DEPARTMENTS.join(', ')}`,
  hireDate: (v) =>
    typeof v === 'string' && isRealDate(v) ? null : 'Hire date must be a valid date (YYYY-MM-DD)',
  status: (v) => (STATUSES.includes(v) ? null : `Status must be one of: ${STATUSES.join(', ')}`),
};

function normalize(field, v) {
  if (field === 'email') return v.trim().toLowerCase();
  if (typeof v === 'string' && field !== 'department' && field !== 'status' && field !== 'hireDate') {
    return v.trim();
  }
  return v;
}

/**
 * Validates a request body. Only whitelisted fields are ever copied into `value`,
 * so unknown keys and `$` operators can never reach the database.
 * @param {unknown} body
 * @param {{partial?: boolean}} opts partial = update (every field optional)
 * @returns {{value: object, errors: Record<string,string>}}
 */
function validateEmployee(body, { partial = false } = {}) {
  const errors = {};
  const value = {};
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (src !== body) {
    return { value, errors: { _body: 'Request body must be a JSON object' } };
  }

  for (const field of FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(src, field) && src[field] !== undefined;
    if (!present) {
      if (field === 'status' && !partial) value.status = 'active';
      else if (!partial) errors[field] = RULES[field](undefined);
      continue;
    }
    const err = RULES[field](src[field]);
    if (err) errors[field] = err;
    else value[field] = normalize(field, src[field]);
  }

  if (partial && Object.keys(errors).length === 0 && Object.keys(value).length === 0) {
    errors._body = 'Provide at least one field to update';
  }
  return { value, errors };
}

module.exports = { validateEmployee, DEPARTMENTS, STATUSES, FIELDS };
