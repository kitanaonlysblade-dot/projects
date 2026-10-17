from app.video_compat import compat_command, needs_compat


def info(codec="h264", pix="yuv420p", w=1080, h=1920, fps="30/1", abr="aac", bitrate="3000000", audio=True):
    streams = [{"codec_type": "video", "codec_name": codec, "pix_fmt": pix, "width": w, "height": h,
                "avg_frame_rate": fps, "bit_rate": bitrate}]
    if audio:
        streams.append({"codec_type": "audio", "codec_name": abr})
    return {"streams": streams, "format": {}}


def test_phone_ready_video_is_left_alone():
    assert not needs_compat(info(), ".mp4")
    assert not needs_compat(info(), ".mov")
    assert not needs_compat(info(audio=False), ".mp4")


def test_desktop_style_videos_are_converted():
    assert needs_compat(info(codec="vp9"), ".webm")
    assert needs_compat(info(), ".webm")  # WebM is always converted
    assert needs_compat(info(codec="hevc"), ".mov")
    assert needs_compat(info(pix="yuv420p10le"), ".mp4")
    assert needs_compat(info(w=3840, h=2160), ".mp4")
    assert needs_compat(info(fps="60/1"), ".mp4")
    assert needs_compat(info(bitrate="20000000"), ".mp4")
    assert needs_compat(info(abr="opus"), ".mp4")


def test_command_caps_size_and_frame_rate():
    cmd = compat_command("in.webm", "out.mp4", info(codec="vp9", fps="60/1"))
    joined = " ".join(cmd)
    assert "libx264" in cmd and "yuv420p" in cmd and "+faststart" in cmd
    assert "fps=30" in joined and "min(1080" in joined
    assert cmd[-1] == "out.mp4"
    assert "-an" in compat_command("a", "b", info(audio=False))
