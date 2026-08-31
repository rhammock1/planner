// @ts-check

/**
 * The clock. One function, in one place, outside `core/` - because core is
 * pure and takes today as an argument (spec §11.4). Everything that needs to
 * know what day it is asks here.
 */

/**
 * Local time, not UTC. The page you want when you click the icon is the one
 * on the wall behind you, and at 11pm those are different days.
 *
 * @returns {string} `YYYY-MM-DD`
 */
export function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
