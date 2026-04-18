import { Construction } from 'lucide-react'

export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="px-4 md:px-6 py-8 max-w-3xl mx-auto">
      <p className="text-xs font-bold text-primary-purple uppercase tracking-widest mb-1">
        {title}
      </p>
      <h1 className="text-2xl font-semibold text-deep-plum mb-6">{title}</h1>

      <div className="rounded-2xl border-2 border-dashed border-lavender bg-white px-8 py-16 text-center shadow-sm">
        <Construction size={36} className="text-lavender mx-auto mb-3" />
        <p className="text-lg font-semibold text-deep-plum">Coming Soon</p>
        <p className="text-sm text-purple-gray mt-1">
          This page is under development and will be available shortly.
        </p>
      </div>
    </div>
  )
}
