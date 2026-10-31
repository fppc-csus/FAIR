import express from 'express';
import prisma from '../lib/prisma.js';

const router = express.Router();

const RESULT_LIMIT = 8;

router.get('/', async (req, res, next) => {
  if (req.query.q !== undefined && (typeof req.query.q !== 'string' || req.query.q.length > 500)) return res.status(400).json({ error: 'Invalid search query' });
  const query = (req.query.q ?? '').trim();

  if (!query) {
    return res.status(200).json({
      query: '',
      groups: {
        politicians: [],
        agendaItems: [],
        conflicts: [],
      },
      total: 0,
    });
  }

  try {
    const [politicians, agendaItems, conflicts] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          p.id,
          p.slug,
          p.full_name AS "fullName",
          p.office_title AS "officeTitle",
          p.party,
          ts_rank(
            to_tsvector(
              'english',
              coalesce(p.full_name, '')
  || ' ' || coalesce(p.office_title, '')
  || ' ' || coalesce(p.party, '')
  || ' ' || coalesce(p.district, '')
  || ' ' || coalesce(p.slug, '')
            ),
            websearch_to_tsquery('english', ${query})
          ) AS rank
        FROM politicians p
        WHERE to_tsvector(
          'english',
          coalesce(p.full_name, '')
  || ' ' || coalesce(p.office_title, '')
  || ' ' || coalesce(p.party, '')
  || ' ' || coalesce(p.district, '')
  || ' ' || coalesce(p.slug, '')
        ) @@ websearch_to_tsquery('english', ${query})
        ORDER BY rank DESC, p.full_name ASC
        LIMIT ${RESULT_LIMIT}
      `,

      prisma.$queryRaw`
        SELECT
          a.id,
          a.title,
          a.description,
          a.city_name AS "cityName",
          a.meeting_date AS "meetingDate",
          ts_rank(
            to_tsvector(
              'english',
              coalesce(a.title, '')
  || ' ' || coalesce(a.description, '')
  || ' ' || coalesce(a.item_text, '')
  || ' ' || coalesce(a.city_name, '')
  || ' ' || coalesce(a.body_name, '')
            ),
            websearch_to_tsquery('english', ${query})
          ) AS rank
        FROM agenda_items a
        WHERE to_tsvector(
          'english',
          coalesce(a.title, '')
  || ' ' || coalesce(a.description, '')
  || ' ' || coalesce(a.item_text, '')
  || ' ' || coalesce(a.city_name, '')
  || ' ' || coalesce(a.body_name, '')
        
        ) @@ websearch_to_tsquery('english', ${query})
        ORDER BY rank DESC, a.meeting_date DESC NULLS LAST
        LIMIT ${RESULT_LIMIT}
      `,

      prisma.$queryRaw`
        SELECT
          c.id,
          c.conflict_type AS "conflictType",
          c.severity,
          c.entity_name AS "entityName",
          c.detected_at AS "detectedAt",
          p.slug AS "politicianSlug",
          p.full_name AS "politicianName",
          a.title AS "agendaTitle",
          a.description AS "agendaDescription",
          ts_rank(
            to_tsvector(
              'english',
              coalesce(c.conflict_type, '')
  || ' ' || coalesce(c.severity, '')
  || ' ' || coalesce(c.rule_reference, '')
  || ' ' || coalesce(c.entity_name, '')
  || ' ' || coalesce(c.source_key, '')
  || ' ' || coalesce(p.full_name, '')
  || ' ' || coalesce(p.office_title, '')
  || ' ' || coalesce(a.title, '')
  || ' ' || coalesce(a.description, '')
  || ' ' || coalesce(a.item_text, '')
            ),
            websearch_to_tsquery('english', ${query})
          ) AS rank
        FROM conflicts c
        JOIN politicians p ON p.id = c.politician_id
        JOIN agenda_items a ON a.id = c.agenda_item_id
        WHERE (c.eligibility_status IS NULL OR c.eligibility_status = 'active')
        AND to_tsvector(
          'english',
          coalesce(c.conflict_type, '')
  || ' ' || coalesce(c.severity, '')
  || ' ' || coalesce(c.rule_reference, '')
  || ' ' || coalesce(c.entity_name, '')
  || ' ' || coalesce(c.source_key, '')
  || ' ' || coalesce(p.full_name, '')
  || ' ' || coalesce(p.office_title, '')
  || ' ' || coalesce(a.title, '')
  || ' ' || coalesce(a.description, '')
  || ' ' || coalesce(a.item_text, '')
        ) @@ websearch_to_tsquery('english', ${query})
        ORDER BY rank DESC, c.detected_at DESC
        LIMIT ${RESULT_LIMIT}
      `,
    ]);

    const groups = {
      politicians: politicians.map((politician) => ({
        type: 'politician',
        id: politician.id,
        title: politician.fullName,
        preview: [politician.officeTitle, politician.party]
          .filter(Boolean)
          .join(' · '),
        href: `/politicians/${politician.slug}`,
      })),

      agendaItems: agendaItems.map((item) => ({
        type: 'agendaItem',
        id: item.id,
        title: item.title || 'Untitled agenda item',
        preview: [item.cityName, item.description]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 180),
        href: `/agenda/${item.id}`,
      })),

      conflicts: conflicts.map((conflict) => ({
        type: 'conflict',
        id: conflict.id,
        title: conflict.conflictType,
        preview: [
          conflict.politicianName,
          conflict.entityName,
          conflict.agendaTitle,
          `Severity: ${conflict.severity}`,
        ]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 180),
        href: `/conflicts/${conflict.id}`,
      })),
    };

    return res.status(200).json({
      query,
      groups,
      total:
        groups.politicians.length +
        groups.agendaItems.length +
        groups.conflicts.length,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;