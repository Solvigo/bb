import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** ~90s of frames at FRAME_INTERVAL_MS, longer than the 60s measurement window. */
const MAX_FRAMES = 900;
const FRAME_INTERVAL_MS = 100;
const BOUNDARY = "frame";

/** A 2x2 solid-colour baseline JPEG (286 bytes), so each part is a real image. */
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6T/2wBDARweHigjKE4rK06kbl1upKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKT/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAGBT//2Q==";

const JPEG = Uint8Array.from(Buffer.from(JPEG_BASE64, "base64"));

export default async function streamProbe(bb: BbPluginApi): Promise<void> {
  bb.http.route(
    "GET",
    "/stream",
    () => {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setInterval> | null = null;
      const stop = (): void => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let frame = 0;
          timer = setInterval(() => {
            frame += 1;
            try {
              controller.enqueue(
                encoder.encode(
                  `--${BOUNDARY}\r\n` +
                    `Content-Type: image/jpeg\r\n` +
                    `Content-Length: ${JPEG.length}\r\n` +
                    `X-Frame-Index: ${frame}\r\n` +
                    `X-Frame-Sent-Ms: ${Date.now()}\r\n\r\n`,
                ),
              );
              controller.enqueue(JPEG);
              controller.enqueue(encoder.encode("\r\n"));
            } catch {
              stop();
              return;
            }
            if (frame >= MAX_FRAMES) {
              stop();
              controller.enqueue(encoder.encode(`--${BOUNDARY}--\r\n`));
              controller.close();
            }
          }, FRAME_INTERVAL_MS);
        },
        cancel() {
          stop();
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
          "cache-control": "no-cache, no-transform",
        },
      });
    },
    { auth: "local" },
  );

  bb.http.route(
    "GET",
    "/ping",
    () =>
      new Response(JSON.stringify({ ok: true, maxFrames: MAX_FRAMES }), {
        headers: { "content-type": "application/json" },
      }),
    { auth: "local" },
  );
}
