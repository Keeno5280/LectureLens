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

/**
 * A closed vocabulary. Free-text tags do not cluster, and un-clusterable
 * tags make the deferred cross-quiz pattern pass worthless. Every value here
 * is a confusion the worked example (~/hcli-school/weeks/week-01/review.md)
 * actually names.
 */
export const CONFUSION_TAGS = [
  'absolutizing-word',        // "enough" / "only" / "never" was the thing being graded
  'collapsed-distinction',    // two deliberately-separated concepts treated as one
  'answered-tone-not-claim',  // agreed with the sentiment instead of evaluating the assertion
  'wrong-category',           // right kind of answer, wrong axis (books vs. acts)
  'recall-gap',               // simply did not retain it
  'judgment-under-tension',   // had to hold two true things and spot which was tested
  'misread-question',         // missed a NOT / EXCEPT / "which is false"
  'careless',                 // no conceptual issue
] as const

export const ParsedQuizItemSchema = z.object({
  position: z.number().int().min(1).describe('The question number as it appears on the quiz.'),
  question_text: z.string(),
  question_type: z.enum(['multiple_choice', 'true_false', 'short_answer']),
  options: z.array(z.string())
    .describe('Empty for true_false and short_answer. The confirm table renders True/False from question_type.'),
  student_answer: z.string().nullable()
    .describe('Null if you cannot tell what the student chose. Never guess.'),
  correct_answer: z.string().nullable()
    .describe('Null if the quiz does not show it.'),
  is_correct: z.boolean(),
})

export const ParsedQuizSchema = z.object({
  quiz_title: z.string().nullable(),
  score_correct: z.number().int().nullable().describe('As REPORTED by the quiz, not recomputed.'),
  score_total: z.number().int().nullable().describe('As REPORTED by the quiz, not recomputed.'),
  items: z.array(ParsedQuizItemSchema),
  unreadable: z.array(z.string())
    .describe('Anything you could not make out. Report it here rather than guessing.'),
})

export const DiagnosisSchema = z.object({
  lecture_coverage: z.enum(['covered', 'partial', 'not-in-lecture'])
    .describe("'not-in-lecture' REQUIRES an empty citations array."),
  correct_answer: z.string(),
  why_correct: z.string().describe('The reasoning chain, not the answer key.'),
  citations: z.array(z.object({
    quote: z.string().describe("The lecturer's own words. VERBATIM — this is checked in code."),
    supports: z.string().describe('What this quote establishes.'),
  })),
  where_it_went_sideways: z.array(z.object({
    confusion: z.string().describe('Name the specific confusion. "Incorrect" is not a diagnosis.'),
    explanation: z.string(),
  })).min(1),
  collapsed_distinction: z.object({
    this_: z.string(),
    not_that: z.string(),
  }).nullable().describe('Null if the miss was not a collapsed distinction.'),
  dont_overcorrect: z.string().describe('What being wrong here does NOT mean.'),
  what_this_miss_was_not: z.string()
    .describe('Do not inflate. If it was careless, say it was careless.'),
  remember_this: z.string().describe('One sentence.'),
  why_it_matters: z.string().describe('Why this matters past the quiz.'),
  confusion_tags: z.array(z.enum(CONFUSION_TAGS)).min(1),
})

export type ConfusionTag = (typeof CONFUSION_TAGS)[number]
export type ParsedQuiz = z.infer<typeof ParsedQuizSchema>
export type ParsedQuizItem = z.infer<typeof ParsedQuizItemSchema>
export type Diagnosis = z.infer<typeof DiagnosisSchema>
