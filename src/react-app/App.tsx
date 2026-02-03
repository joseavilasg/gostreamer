import { MediaPlayer, MediaProvider, Poster } from '@vidstack/react';
import {
  PlyrLayout,
  plyrLayoutIcons,
} from '@vidstack/react/player/layouts/plyr';

function App() {
  return (
    <MediaPlayer
      src="http://localhost:5173/server/stream.m3u8"
      style={{ width: '100%', height: '100%' }}
      title="The Muppet Show"
    >
      <MediaProvider>
        <Poster
          alt="The Muppet Show"
          className="media-poster"
          src="https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/019be70d-36a5-7d2a-8d14-9022cc8859c3/compose?format=webp&width=1440"
        />
      </MediaProvider>
      <PlyrLayout
        icons={plyrLayoutIcons}
        // thumbnails="https://files.vidstack.io/sprite-fight/thumbnails.vtt"
      />
    </MediaPlayer>
  );
}

export default App;
