const DETECTION_FIELDS = ['title', 'description', 'itemText'];

export async function upsertAgendaItems(prisma, rows, getWhere, { includeUnchanged = false } = {}) {
  let inserted = 0;
  let skipped = 0;
  const changedIds = [];

  for (const row of rows) {
    const where = getWhere(row);
    const existing = await prisma.agendaItem.findUnique({
      where,
      select: { id: true, ...Object.fromEntries(DETECTION_FIELDS.map((field) => [field, true])) },
    });
    const saved = await prisma.agendaItem.upsert({
      where,
      create: row,
      update: row,
    });

    if (!existing) {
      inserted += 1;
      changedIds.push(saved.id);
      continue;
    }

    skipped += 1;
    if (includeUnchanged || DETECTION_FIELDS.some((field) => (existing[field] ?? null) !== (row[field] ?? null))) {
      changedIds.push(saved.id);
    }
  }

  return { inserted, skipped, changedIds };
}
