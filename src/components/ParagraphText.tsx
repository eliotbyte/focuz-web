export default function ParagraphText({ text, className }: { text: string; className?: string }) {
  const lines = (text || '').split(/\r?\n/)
  const containerClass = `block leading-6 space-y-3 ${className || ''}`.trim()
  return (
    <div className={containerClass}>
      {lines.map((line, idx) => (
        <p key={idx}>
          {line === '' ? '\u00A0' : line}
        </p>
      ))}
    </div>
  )
}


