// Final video panel — shows the master MP4 produced by /fk-concat or
// /fk-finalize for the selected video, plus thumbnails and the YouTube
// metadata file. Renders nothing until the API resolves; if no master file
// exists, shows a small hint instead.
import { useEffect, useState } from 'react'
import { fetchAPI } from '../../api/client'

interface FinalInfo {
  project_slug: string
  master: { url: string; size: number } | null
  thumbnails: string[]
  youtube_metadata_url: string | null
  youtube_id: string | null
  stored_url: string | null
}

interface Props {
  videoId: string
}

function fmtSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

export default function FinalVideoPanel({ videoId }: Props) {
  const [info, setInfo] = useState<FinalInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchAPI<FinalInfo>(`/api/videos/${videoId}/final`)
      .then(setInfo)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [videoId])

  if (loading) {
    return (
      <div className="text-xs" style={{ color: 'var(--muted)' }}>
        Loading final video...
      </div>
    )
  }

  if (error || !info) {
    return (
      <div className="text-xs" style={{ color: 'var(--muted)' }}>
        {error ?? 'No final info'}
      </div>
    )
  }

  const hasMaster = !!info.master
  const ytUrl = info.youtube_id ? `https://youtu.be/${info.youtube_id}` : null

  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>
          Final Video
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
          {hasMaster && <span>{fmtSize(info.master!.size)}</span>}
          {ytUrl && (
            <a href={ytUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
              YouTube ↗
            </a>
          )}
        </div>
      </div>

      {!hasMaster ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          Chưa có file master. Chạy <code>/fk-concat</code> hoặc <code>/fk-finalize</code> để
          render video cuối.
        </div>
      ) : (
        <>
          <video
            src={info.master!.url}
            controls
            preload="metadata"
            className="w-full rounded"
            style={{ maxHeight: '60vh', background: '#000' }}
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={info.master!.url}
              download
              className="px-3 py-1.5 rounded font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', textDecoration: 'none' }}
            >
              Download master
            </a>
            {info.youtube_metadata_url && (
              <a
                href={info.youtube_metadata_url}
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded font-semibold"
                style={{ background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', textDecoration: 'none' }}
              >
                YouTube metadata
              </a>
            )}
          </div>

          {info.thumbnails.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>
                Thumbnails ({info.thumbnails.length})
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {info.thumbnails.map(t => (
                  <a key={t} href={t} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={t}
                      alt="thumbnail"
                      className="rounded"
                      style={{ height: 80, border: '1px solid var(--border)' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
