import { z } from 'zod'

/** One assertion the lecturer made, with the words they used. */
export const ClaimSchema = z.object({
  statement: z.string().describe('The claim, stated plainly.'),
  quote: z.string().describe("The lecturer's own words supporting it. Verbatim."),
  emphasis: z.enum(['stated-definition', 'repeated', 'flagged', 'passing'])
    .describe("'flagged' means the lecturer signalled it would be tested."),
  contested: z.boolean()
    .describe('True if other traditions, schools, or authorities hold this differently.'),
})

/** Two things the lecturer deliberately separated. Quiz traps live here. */
export const DistinctionSchema = z.object({
  this_: z.string().describe('The thing being asserted.'),
  not_that: z.string().describe('The thing it is being distinguished FROM.'),
  why_confusable: z.string().describe('Why a student would collapse the two.'),
})

export const LectureAnalysisSchema = z.object({
  summary_overview: z.string(),
  key_points: z.array(z.string()),
  important_terms: z.array(z.object({
    term: z.string(),
    definition: z.string().describe('As the LECTURE defined it, not a dictionary definition.'),
  })),
  exam_questions: z.array(z.string()),
  flashcards: z.array(z.object({ front: z.string(), back: z.string() })),
  claims: z.array(ClaimSchema),
  distinctions: z.array(DistinctionSchema),
})

export type LectureAnalysis = z.infer<typeof LectureAnalysisSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type Distinction = z.infer<typeof DistinctionSchema>
