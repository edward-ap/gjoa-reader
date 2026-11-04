export const gridExporters = Object.freeze({
  csv: options => createDelimitedExporter({ delimiter: ",", includeHeaders: true, ...options }),
  tsv: options => createDelimitedExporter({ delimiter: "\t", includeHeaders: true, ...options }),
  workbook: options => createWorkbookExporter(options)
});

export function createDelimitedExporter(options = {}) {
  const delimiter = options.delimiter ?? ",";
  const cell = value => quote(spreadsheetValue(value, options.escapeFormulas === true), delimiter);
  return {
    export(context) {
      const lines = [];
      if (options.includeHeaders !== false) {
        lines.push(context.columns.map(column => cell(column.title ?? column.label ?? column.id)).join(delimiter));
      }
      for (const row of context.rows) {
        lines.push(context.columns.map(column => cell(context.getValue(row, column))).join(delimiter));
      }
      return lines.join("\r\n");
    }
  };
}

// Opt-in spreadsheet presentation; preserve numeric values and raw export defaults.
function spreadsheetValue(value, escapeFormulas) {
  if (!escapeFormulas || typeof value !== "string") return value;
  return /^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
}

function createWorkbookExporter(options = {}) {
  return {
    export(context) {
      return {
        type: "workbook",
        sheets: [{
          name: options.sheetName ?? "Grid",
          columns: context.columns.map(column => ({ id:column.id, title:column.title ?? column.label ?? column.id })),
          rows: context.rows.map(row => context.columns.map(column => context.getValue(row, column)))
        }]
      };
    }
  };
}

function quote(value, delimiter) {
  const text = value == null ? "" : String(value);
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}
