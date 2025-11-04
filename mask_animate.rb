require 'rmagick'
include Magick

COMPOSITE_OP =
  if Magick.constants.include?(:CopyAlphaCompositeOp)
    Magick::CopyAlphaCompositeOp
  else
    Magick::CopyOpacityCompositeOp
  end

bg_path         = '/Users/simon/Desktop/PROOFS/Samos_town.png'
overlays_glob   = 'rain_loop_frames/frame_*.png'
mask_path       = 'rain_loop_mask_frames/overlay_001_mask.png'  # or compute per-frame
output_gif_path = 'out.gif'
frame_delay_ms  = 100
invert_mask     = false   # <- set to TRUE if your exported mask is white-over-background / black-over-rain

def read1(p) = Magick::Image.read(p).first

def ensure_alpha!(img)
  img.alpha(Magick::ActivateAlphaChannel) unless img.alpha?
  img
end

def multiply_mask(overlay, mask, invert:, resize_to:)
  ov = overlay.copy
  ensure_alpha!(ov)

  m = mask.copy
  m = m.quantize(256, Magick::GRAYColorspace)
  m = m.resize_to_fill(*resize_to) unless (m.columns == resize_to[0] && m.rows == resize_to[1])
  m = m.negate if invert

  # convert brightness to alpha
  m.composite!(m, 0, 0, Magick::CopyAlphaCompositeOp)

  # keep overlay only where mask is opaque (white)
  ov.composite!(m, 0, 0, Magick::DstInCompositeOp)
  ov
end

# --- 1) make a reusable text overlay (transparent PNG the size of bg) ---
def build_text_overlay(w:, h:, text:, font: "Helvetica", pointsize: 48,
                       fill: "white", stroke: "white", stroke_width: 2,
                       gravity: Magick::SouthGravity, margin_px: 24,
                       add_backdrop: true, backdrop_fill: "rgba(0,0,0,0.35)", radius: 12)

  overlay = Magick::Image.new(w, h) { |i| i.background_color = "transparent" }


  d = Magick::Draw.new
  d.font = font
  d.pointsize = pointsize
  d.fill = fill
  d.stroke = stroke
  d.stroke_width = stroke_width
  d.gravity = gravity
  d.kerning = 0

  # measure text to optionally draw a soft backdrop under it
  metrics = d.get_type_metrics(overlay, text)
  tw = metrics.width.ceil
  th = (metrics.height + metrics.descent).ceil
  bw = tw + 2 * margin_px
  bh = th + 2 * margin_px

  if add_backdrop
    # draw rounded rectangle behind the text at the chosen gravity
    bx1 = (w - bw) / 2.0
    by1 = case gravity
          when Magick::SouthGravity then h - bh - margin_px
          when Magick::NorthGravity then margin_px
          else                          (h - bh) / 2.0
          end
    bx2 = bx1 + bw
    by2 = by1 + bh

    dr = Magick::Draw.new
    dr.fill = backdrop_fill
    dr.stroke = "none"
    dr.roundrectangle(bx1, by1, bx2, by2, radius, radius)
    dr.draw(overlay)
  end

  # render the text itself
  d.annotate(overlay, 0, 0, 0, margin_px, text) # offset = margin from baseline at SouthGravity
  overlay
end

def apply_mask_to_overlay(overlay, mask, invert:, resize_to:)
  ov = overlay.copy
  ensure_alpha!(ov)

  m = mask.copy
  m = m.quantize(256, Magick::GRAYColorspace)
  m = m.resize_to_fill(*resize_to) unless (m.columns == resize_to[0] && m.rows == resize_to[1])
  m = m.negate if invert           # flip if your mask polarity is opposite

  # Copy mask luminance into OVERLAY alpha (background never touched)
  ov.composite!(m, 0, 0, COMPOSITE_OP)
  ov
end

bg   = read1(bg_path)


text_overlay = build_text_overlay(
  w: bg.columns, h: bg.rows,
  text: "Proofs & Reasons @ CMU",
  font: "DejaVuSansMono",         # pick any installed font
  pointsize: 54,
  fill: "white",
  stroke: "none",
  gravity: Magick::NorthGravity,  # North/South/Center etc.
  margin_px: 24,
  add_backdrop: false              # switch to false if you don’t want the semi-transparent box
)

# text_overlay_2 = build_text_overlay(
#   w: bg.columns, h: bg.rows,
#   text: "Type Theory over the Island of Samos ",
#   font: "DejaVuSansMono",         # pick any installed font
#   pointsize: 16,
#   fill: "white",
#   stroke: "none", stroke_width: 0,
#   gravity: Magick::SouthEastGravity,  # North/South/Center etc.
#   margin_px: 5,
#   add_backdrop: false              # switch to false if you don’t want the semi-transparent box
# )

text_overlay_3 = build_text_overlay(
  w: bg.columns, h: bg.rows,
  text: "supported by the John Templeton Foundation",
  font: "DejaVuSansMono",         # pick any installed font
  pointsize: 24,
  fill: "white",
  stroke: "none", stroke_width: 0,
  gravity: Magick::SouthGravity,  # North/South/Center etc.
  margin_px: 5,
  add_backdrop: false              # switch to false if you don’t want the semi-transparent box
)


list = Magick::ImageList.new
cs   = (frame_delay_ms / 10.0).round


Dir.glob(overlays_glob).sort.each_with_index do |ov_path, i|
  ov = read1(ov_path)
  ov = ov.resize_to_fit(bg.columns, bg.rows) unless ov.columns == bg.columns && ov.rows == bg.rows

  mask = read1(mask_path)  # or compute a per-frame path if masks differ
  ov_masked = multiply_mask(ov, mask, invert: invert_mask, resize_to: [ov.columns, ov.rows])
  # ov_masked=ov

  # --- DEBUG: write overlay-alone to be sure only rain remains opaque ---
  # ov_masked.write("DEBUG_overlay_only_%03d.png" % (i+1))  # uncomment once to verify
  # Expectation: you should see *just the rain strokes*. Everywhere else fully transparent.

  # Compose masked overlay over an untouched COPY of the background
  frame = bg.copy
  frame.composite!(ov_masked, 0, 0, Magick::OverCompositeOp)
  frame.composite!(text_overlay, 0, 0, Magick::OverCompositeOp) # text on top
  # frame.composite!(text_overlay_2, -5, 0, Magick::OverCompositeOp) # text on top
  frame.composite!(text_overlay_3, 10, 0, Magick::OverCompositeOp) # text on top
  
  frame.delay = cs
  frame.iterations = 0
  list << frame
end

# list = list.quantize(128, Magick::RGBColorspace)
# q = Magick::QuantumRange
# list.each { |f| f.fuzz = (0.03 * q).to_i }      # optional: tolerate tiny color diffs (~3%)
list = list.optimize_layers(Magick::OptimizeTransLayer)
list.write(output_gif_path)
