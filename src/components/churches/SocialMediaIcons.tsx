interface Props {
  instagram: string | null
  facebook: string | null
  youtube: string | null
}

function IgIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FbIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3V2z" />
    </svg>
  )
}

function YtIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M22.54 6.42a2.78 2.78 0 00-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 2A29 29 0 001 11.75a29 29 0 00.46 5.33A2.78 2.78 0 003.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 001.94-2 29 29 0 00.46-5.25 29 29 0 00-.46-5.43z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="white" />
    </svg>
  )
}

export default function SocialMediaIcons({ instagram, facebook, youtube }: Props) {
  const links = [
    { url: instagram, Icon: IgIcon, label: 'Instagram' },
    { url: facebook, Icon: FbIcon, label: 'Facebook' },
    { url: youtube, Icon: YtIcon, label: 'YouTube' },
  ].filter(l => l.url)

  if (links.length === 0) return <span className="text-purple-gray/30">—</span>

  return (
    <div className="flex items-center gap-1.5">
      {links.map(({ url, Icon, label }) => (
        <a
          key={label}
          href={url!}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
          className="text-purple-gray hover:text-primary-purple transition-colors"
          onClick={e => e.stopPropagation()}
        >
          <Icon />
        </a>
      ))}
    </div>
  )
}
