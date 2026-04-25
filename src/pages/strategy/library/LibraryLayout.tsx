import { Outlet } from 'react-router-dom'
import { LibraryDataProvider } from '../../../components/library/LibraryDataContext'

/** Mounts at `/strategy/library/*`. Wraps every Library sub-route in the
 *  shared data provider and the warm off-white background that defines
 *  the module's visual identity. */
export default function LibraryLayout() {
  return (
    <div className="min-h-full bg-[var(--color-lib-bg)] text-[var(--color-lib-text)]">
      <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <LibraryDataProvider>
          <Outlet />
        </LibraryDataProvider>
      </div>
    </div>
  )
}
