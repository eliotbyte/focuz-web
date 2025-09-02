export function formatRelativeShort(input: string | Date, nowDate: Date = new Date()): string {
	const date = typeof input === 'string' ? new Date(input) : input
	const diffMs = Math.max(0, nowDate.getTime() - date.getTime())

	const minuteMs = 60 * 1000
	const hourMs = 60 * minuteMs
	const dayMs = 24 * hourMs
	const weekMs = 7 * dayMs

	if (diffMs < minuteMs) return 'just now'

	const minutes = Math.floor(diffMs / minuteMs)
	if (minutes < 60) return `${minutes}m`

	const hours = Math.floor(diffMs / hourMs)
	if (hours < 24) return `${hours}h`

	const days = Math.floor(diffMs / dayMs)
	if (days < 7) return `${days}d`

	const weeks = Math.floor(diffMs / weekMs)
	if (weeks < 5) return `${weeks}w`

	// Months: approximate by 30-day months, as per short social-style formatting
	const months = Math.floor(days / 30)
	if (months >= 1 && months < 12) return `${months}mo`

	const years = Math.floor(days / 365)
	return `${years}y`
}

export function formatExactDateTime(input: string | Date): string {
	const d = typeof input === 'string' ? new Date(input) : input
	const pad = (n: number) => n.toString().padStart(2, '0')
	const DD = pad(d.getDate())
	const MM = pad(d.getMonth() + 1)
	const YYYY = d.getFullYear().toString()
	const HH = pad(d.getHours())
	const mm = pad(d.getMinutes())
	const SS = pad(d.getSeconds())
	return `${DD}-${MM}-${YYYY} ${HH}:${mm}:${SS}`
} 