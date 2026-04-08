/** Display: Class_(number), Section (letter), Batch (year) */
export function formatClassLabel(c) {
  if (!c || c.classNumber == null || !c.section || c.batchYear == null) return ''
  return `Class_${c.classNumber}, Section ${String(c.section).toUpperCase()}, Batch ${c.batchYear}`
}
