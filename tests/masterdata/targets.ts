import { Page } from '@playwright/test';

/** One form field. `unique` fields are used for duplicate checks and to find the row. */
export type Field = {
  label: string;            // exact accessible label on the form
  kind: 'text' | 'select';
  required: boolean;
  unique?: boolean;
  /** Value for a new record; `k` is the unique test key (e.g. PWT123456789). */
  value: (k: string) => string;
  /** Value used when editing. Omit to leave the field unchanged. */
  editValue?: (k: string) => string;
};

export type Target = {
  ticket: number;
  name: string;                 // test title
  listPath: string;
  createPath: string;
  formScreen: string;           // used to recognise the edit URL
  createButton: string;         // button on list page
  createTitle: RegExp;          // heading on create form
  editTitle: RegExp;            // heading on edit form
  searchPlaceholder: string;
  submitButton: 'Save' | 'Submit';
  fields: Field[];
  /** Columns the list must show (FSD field list). */
  columns: string[];
  /** Text that identifies the record in the list row. */
  rowKey: (k: string) => string;
  /** Sortable list column that holds the unique value (used by the sorting test). */
  sortColumn: string;
};

/** Codes are kept short; the existing data uses 12-char codes (e.g. D20240202001). */
const code = (k: string) => k;
const codeName = (opts: {
  ticket: number; name: string; plural: string; list: string; form: string; idParam: string; label: string;
  /** Column headers the app shows today when they differ from the FSD (tracked in fsd-gaps.spec.ts). */
  appColumns?: [string, string];
}): Target => {
  const lower = opts.label.toLowerCase();
  return {
    ticket: opts.ticket,
    name: opts.name,
    listPath: opts.list,
    createPath: `${opts.form}?${opts.idParam}=0`,
    formScreen: opts.form,
    createButton: `Create new ${lower}`,
    createTitle: new RegExp(`^Create new ${lower}$`, 'i'),
    editTitle: new RegExp(`^Edit ${lower}$`, 'i'),
    searchPlaceholder: 'Search by code or name',
    submitButton: 'Save',
    fields: [
      { label: `${opts.label} code`, kind: 'text', required: false, unique: true, value: code },
      { label: `${opts.label} name *`, kind: 'text', required: true, unique: true, value: k => `PW ${lower} ${k}`, editValue: k => `PW ${lower} ${k} edited` },
    ],
    columns: [...(opts.appColumns ?? [`${opts.label} code`, `${opts.label} name`]), 'Status', 'Created on', 'Created by', 'Last modified on', 'Last modified by', 'Action'],
    rowKey: k => k,
    sortColumn: opts.appColumns?.[1] ?? `${opts.label} name`,
  };
};

export const targets: Target[] = [
  {
    ticket: 100,
    name: 'Task Type',
    listPath: 'TaskTypesManagement',
    createPath: 'TaskType?TaskTypeId=0',
    formScreen: 'TaskType',
    createButton: 'Create new task type',
    createTitle: /^Create new task type$/i,
    editTitle: /^Edit task type$/i,
    searchPlaceholder: 'Search by task type',
    submitButton: 'Save',
    fields: [
      { label: 'Task type', kind: 'text', required: true, unique: true, value: k => `PW task ${k}`, editValue: k => `PW task ${k} edited` },
      // App options (Urgent/High/Medium/Low) differ from FSD 9.3 – see fsd-gaps.spec.ts
      { label: 'Priority', kind: 'select', required: true, value: () => 'High', editValue: () => 'Low' },
      { label: 'Task description', kind: 'text', required: true, value: k => `Created by Playwright ${k}`, editValue: k => `Updated by Playwright ${k}` },
    ],
    columns: ['Task type', 'Task description', 'Priority', 'Status', 'Created on', 'Created by', 'Last modified on', 'Last modified by', 'Action'],
    rowKey: k => `PW task ${k}`,
    sortColumn: 'Task type',
  },
  codeName({ ticket: 102, name: 'Division', plural: 'Divisions', list: 'DivisionsManagement', form: 'Division', idParam: 'DivisionId', label: 'Division' }),
  codeName({ ticket: 103, name: 'Department', plural: 'Departments', list: 'DepartmentsManagement', form: 'Department', idParam: 'DepartmentId', label: 'Department', appColumns: ['Code', 'Name'] }),
  codeName({ ticket: 104, name: 'Section', plural: 'Sections', list: 'SectionsManagement', form: 'Section', idParam: 'SectionId', label: 'Section' }),
  codeName({ ticket: 105, name: 'Group', plural: 'Groups', list: 'GroupsManagement', form: 'Group', idParam: 'OrgGroupId', label: 'Group' }),
  codeName({ ticket: 106, name: 'Store Area Team', plural: 'Store area teams', list: 'StoreAreaTeamsManagement', form: 'StoreAreaTeam', idParam: 'StoreAreaTeamId', label: 'Store area team' }),
  codeName({ ticket: 107, name: 'Cost Center', plural: 'Cost centers', list: 'CostCentersManagement', form: 'CostCenter', idParam: 'CostCenterId', label: 'Cost center' }),
  {
    ticket: 110,
    name: 'Insurer',
    listPath: 'InsurersManagement',
    createPath: 'Insurer?InsurerId=0',
    formScreen: 'Insurer',
    createButton: 'Create insurance',
    createTitle: /^Create new insurer$/i,
    editTitle: /^Edit/i,
    searchPlaceholder: 'Search by name or email',
    submitButton: 'Submit',
    fields: [
      { label: 'Claim category *', kind: 'select', required: true, value: () => 'General Liability', editValue: () => 'Industrial All Risks' },
      { label: 'Description *', kind: 'text', required: true, value: k => `Created by Playwright ${k}`, editValue: k => `Updated by Playwright ${k}` },
      { label: 'Insurer *', kind: 'text', required: true, unique: true, value: k => `PW insurer ${k}`, editValue: k => `PW insurer ${k} edited` },
      { label: 'Email *', kind: 'text', required: true, value: k => `${k.toLowerCase()}@example.com` },
    ],
    columns: ['Claim category', 'Insurer', 'Description', 'Email', 'Status', 'Created on', 'Created by', 'Last modified on', 'Last modified by', 'Action'],
    rowKey: k => `PW insurer ${k}`,
    sortColumn: 'Insurer',
  },
  {
    ticket: 113,
    name: 'Case Reason',
    listPath: 'CaseReasonsManagement',
    createPath: 'CaseReasonForm?CaseReasonId=0',
    formScreen: 'CaseReasonForm',
    createButton: 'Create new case reason',
    createTitle: /^Create new case reason$/i,
    editTitle: /^Edit/i,
    searchPlaceholder: 'Search by case action or reason',
    submitButton: 'Submit',
    fields: [
      // First real option is used; the test is skipped if the dropdown has no options.
      { label: 'Case action *', kind: 'select', required: true, value: () => '' },
      { label: 'Reason *', kind: 'text', required: true, unique: true, value: k => `PW reason ${k}`, editValue: k => `PW reason ${k} edited` },
    ],
    columns: ['Status', 'Created on', 'Created by', 'Action'],
    rowKey: k => `PW reason ${k}`,
    sortColumn: 'Reason',
  },
];

/** Unique, short key per record: PWT + 9 digits (12 chars, fits code fields). */
let seq = 0;
export function newKey(workerIndex = 0) {
  seq = (seq + 1) % 100;
  const t = (Date.now() % 1_000_000).toString().padStart(6, '0');
  return `PWT${workerIndex % 10}${t}${seq.toString().padStart(2, '0')}`;
}

/** Prefix used to find leftovers from crashed runs. */
export const KEY_PATTERN = /PWT\d{9}/;

export type Ctx = { page: Page; target: Target };
