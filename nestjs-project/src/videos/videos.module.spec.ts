import { createVideosTestingModule } from '../test/video-test-module';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile with its controller, service and storage dependency', async () => {
    const module = await createVideosTestingModule();

    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    expect(module.get(VideosController)).toBeInstanceOf(VideosController);
    await module.close();
  }, 30000);
});
