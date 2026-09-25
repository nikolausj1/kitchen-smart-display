import './TextBlock.css'

// TextBlock - the family's own words on a board: a house name, a welcome, a
// note. A layout-spec block (layoutSpec.js, type 'text'), so it has no data
// and no chrome of its own; the box around it (Entry/SpecPanel) owns the
// position, background and padding.
//
// size is percent of the screen's height (4 = 4vh), so a line drawn on the
// 1920x1080 Echo keeps its proportion on a 1280x800 one; it follows the box's
// --tl-text-scale like every other panel's type. The text wraps (newlines
// kept) and never draws outside its box: past the bottom it is clipped.
export default function TextBlock({ text = '', size = 4, weight = 600, color, align = 'center', lineHeight = 1.15 }) {
  const style = {
    '--tl-textblock-size': `${size}vh`,
    fontWeight: weight,
    lineHeight,
  }
  if (color) style.color = color
  return (
    <div className={`tl-textblock tl-textblock--${align}`}>
      <div className="tl-textblock__text" style={style} data-edit="text">
        {text}
      </div>
    </div>
  )
}
