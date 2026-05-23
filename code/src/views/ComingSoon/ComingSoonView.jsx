import './ComingSoonView.css'

// ComingSoonView - placeholder for Music and Settings until their real views
// land. Lets the menu pill links go somewhere instead of being dead.

export default function ComingSoonView({ title, subtitle }) {
  return (
    <div className="coming-soon">
      <div className="coming-soon__title">{title}</div>
      {subtitle && <div className="coming-soon__subtitle">{subtitle}</div>}
      <div className="coming-soon__hint">Tap anywhere to open the menu</div>
    </div>
  )
}
