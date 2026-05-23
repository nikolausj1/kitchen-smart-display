import { useEffect, useState } from 'react'
import './TimeDatePanel.css'

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
]

function format(now) {
  const hour12 = now.getHours() % 12 || 12
  const minute = String(now.getMinutes()).padStart(2, '0')
  return {
    time: `${hour12}:${minute}`,
    date: `${DAY_NAMES[now.getDay()]}, ${MONTH_NAMES[now.getMonth()]} ${now.getDate()}`,
  }
}

export default function TimeDatePanel() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    // Tick every second so the minute boundary is never more than ~1s late.
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const { time, date } = format(now)

  return (
    <section className="panel time-date">
      <div className="time-date__inner">
        <div className="time-date__time">{time}</div>
        <div className="time-date__date">{date}</div>
      </div>
    </section>
  )
}
