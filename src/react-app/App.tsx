import { MediaPlayer, MediaProvider, useMediaState } from '@vidstack/react';
import {
  PlyrLayout,
  plyrLayoutIcons,
} from '@vidstack/react/player/layouts/plyr';
import { useEffect, useMemo, useState } from 'react';

type PlayerStreamType = 'live' | 'on-demand';

type StreamTypeResponse = {
  streamType?: 'live' | 'on-demand' | 'unknown';
};

function BufferingOverlay() {
  const canPlay = useMediaState('canPlay');
  const waiting = useMediaState('waiting');
  const seeking = useMediaState('seeking');
  const error = useMediaState('error');

  if (error) return null;

  if (canPlay && !waiting && !seeking) return null;

  return (
    <div aria-hidden="true" className="player-loader">
      <div className="player-loader__spinner" />
    </div>
  );
}

function App() {
  const defaultPath = 'stream.m3u8';
  const pathFromUrl = window.location.pathname.replace(/^\/+/, '');
  const rawStreamPath = pathFromUrl.length > 0 ? pathFromUrl : defaultPath;
  const streamPath = /\.[a-z0-9]+$/i.test(rawStreamPath)
    ? rawStreamPath
    : `${rawStreamPath}.m3u8`;

  const src = `/server/${streamPath}`;
  const streamTypeProbeUrl = useMemo(() => {
    if (!src.startsWith('/server/')) return null;
    return src.replace('/server/', '/server-type/');
  }, [src]);

  const [streamType, setStreamType] = useState<PlayerStreamType>('on-demand');

  useEffect(() => {
    let cancelled = false;

    if (!streamTypeProbeUrl) {
      setStreamType('on-demand');
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      try {
        const response = await fetch(streamTypeProbeUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) return;

        const data = (await response.json()) as StreamTypeResponse;
        if (cancelled) return;

        if (data.streamType === 'live' || data.streamType === 'on-demand') {
          setStreamType(data.streamType);
        }
      } catch (_) {
        // keep fallback
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [streamTypeProbeUrl]);

  return (
    <MediaPlayer
      autoPlay
      className="player-shell"
      src={src}
      streamType={streamType}
      style={{
        width: '100%',
        maxWidth: '1200px',
        aspectRatio: '16/9',
        margin: 'auto',
        position: 'relative',
      }}
      title="Stream"
    >
      <MediaProvider>
        {/* <Poster
          alt="The Muppet Show"
          className="media-poster"
          src="https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/019be70d-36a5-7d2a-8d14-9022cc8859c3/compose?format=webp&width=1440"
        /> */}
      </MediaProvider>
      <BufferingOverlay />
      <PlyrLayout clickToPlay={false} icons={plyrLayoutIcons} />
    </MediaPlayer>
  );
}

export default App;
