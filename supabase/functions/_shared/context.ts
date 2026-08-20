export interface ContextLecture {
  title: string | null
  summary_overview: string | null
  transcript: string | null
}

export function buildTutorContext(input: {
  lectures: ContextLecture[]
  assignmentPrompt: string | null
}): string {
  const parts: string[] = []

  if (input.lectures.length === 0) {
    parts.push('(No lecture content is available for this class yet.)')
  } else {
    const body = input.lectures.map((l) => {
      const lines = [`[Lecture: ${l.title ?? 'Untitled'}]`]
      if (l.summary_overview?.trim()) lines.push(`Summary: ${l.summary_overview}`)
      if (l.transcript?.trim()) lines.push(`Transcript: ${l.transcript.slice(0, 20000)}`)
      return lines.join('\n')
    }).join('\n\n')
    parts.push(`=== CLASS LECTURE CONTENT ===\n${body}`)
  }

  if (input.assignmentPrompt?.trim()) {
    parts.push(`=== ASSIGNMENT RUBRIC ===\n${input.assignmentPrompt}`)
  }

  return parts.join('\n\n')
}
