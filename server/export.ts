/** One quoted CSV cell. User text cannot become a spreadsheet formula. */
export function csvCell(value:string|number):string{
 const plain=String(value);
 const neutralized=typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/u.test(plain)?`'${plain}`:plain;
 return `"${neutralized.replaceAll('"','""')}"`;
}
