import type { ReactElement } from 'react'

/**
 * Simple markdown renderer for AI assistant chat bubbles.
 * Handles bold, bullets, blockquotes, and headings.
 *
 * Shared between TenantAI and AppAssistant components.
 */

function formatInline(line: string) {
  // Bold: **text** and inline code: `text`
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-[12px] font-mono">{part.slice(1, -1)}</code>
    }
    return <span key={i}>{part}</span>
  })
}

export function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: ReactElement[] = []
  let blockquote: string[] = []

  const flushBlockquote = () => {
    if (blockquote.length > 0) {
      elements.push(
        <blockquote key={`bq-${elements.length}`} className="border-l-3 border-blue-400 pl-3 my-2 text-slate-600 italic text-xs leading-relaxed">
          {blockquote.map((l, i) => <span key={i}>{formatInline(l)}{i < blockquote.length - 1 && <br />}</span>)}
        </blockquote>
      )
      blockquote = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Blockquote
    if (line.startsWith('> ')) {
      blockquote.push(line.slice(2))
      continue
    }
    flushBlockquote()

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={`br-${i}`} className="h-2" />)
      continue
    }

    // Heading ###
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-slate-800 text-xs mt-2 mb-0.5">{formatInline(line.slice(4))}</h4>)
      continue
    }

    // Numbered list (e.g., "1. Step one")
    const numberedMatch = line.match(/^(\d+)\.\s+(.*)/)
    if (numberedMatch) {
      elements.push(
        <div key={i} className="flex gap-1.5 ml-1 my-0.5">
          <span className="text-blue-500 font-semibold shrink-0 text-xs w-4">{numberedMatch[1]}.</span>
          <span>{formatInline(numberedMatch[2])}</span>
        </div>
      )
      continue
    }

    // Bullet point
    if (line.match(/^[\u2022\-\*]\s/)) {
      const content = line.replace(/^[\u2022\-\*]\s/, '')
      elements.push(
        <div key={i} className="flex gap-1.5 ml-1 my-0.5">
          <span className="text-blue-500 mt-0.5 shrink-0">&bull;</span>
          <span>{formatInline(content)}</span>
        </div>
      )
      continue
    }

    // Regular paragraph
    elements.push(<p key={i} className="my-0.5">{formatInline(line)}</p>)
  }

  flushBlockquote()
  return elements
}
