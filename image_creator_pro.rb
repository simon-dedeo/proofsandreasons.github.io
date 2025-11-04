
# rain_export_matrixish.rb
# Matrix-ish rain: long streaks, bright head + fading tail, glyph scroll, flicker, seamless loop.
# Uses Pixel colors + annotate (same path that worked in your debug).
# gem install rmagick
require "rmagick"
require 'parallel'
require "digest"
include Magick

# ------------- CONFIG -------------
OUT_DIR           = "rain_loop_frames"
ROWS, COLS        = 24, 48
CANVAS_W = 1024
CANVAS_H = 768
H = 768

SEED              = 12345

# Loop control — one full vertical cycle takes ROWS frames (heads + glyphs wrap)
LOOPS             = 1
FRAME_COUNT       = ROWS * LOOPS

# Streaks (per column)
STREAK_MIN        = 5         # <- make tails long (never 1)
STREAK_MAX        = 14


# Flicker (near head)
FLICKER_ZONE      = 5          # rows behind the head that may flicker
FLICKER_PROB      = 0.12       # per-cell chance (deterministic via seeded RNG)

# Outside-streak background glyphs (dim/faint)
DRAW_BG_PROB      = 0.00       # probability to draw a faint glyph outside the streak
BG_GREEN          = 60         # 0..255 (dim green for background)

# Font
FONT_CANDIDATES   = ["DejaVuSansMono", nil]
# -----------------------------------

Dir.mkdir(OUT_DIR) unless Dir.exist?(OUT_DIR)
srand(SEED)



# Converts HSV (h in degrees 0..360, s,v in 0..1) -> [r,g,b] 0..255
def hsv_to_rgb(h, s, v)
  h = h % 360.0
  s = [[s, 0.0].max, 1.0].min
  v = [[v, 0.0].max, 1.0].min
  c = v * s
  x = c * (1.0 - ((h / 60.0) % 2 - 1.0).abs)
  m = v - c
  rp, gp, bp =
    if    h < 60   then [c, x, 0]
    elsif h < 120  then [x, c, 0]
    elsif h < 180  then [0, c, x]
    elsif h < 240  then [0, x, c]
    elsif h < 300  then [x, 0, c]
    else                [c, 0, x]
    end
  r = ((rp + m) * 255.0).round
  g = ((gp + m) * 255.0).round
  b = ((bp + m) * 255.0).round
  [r, g, b]
end


# ---------- helpers (same style as your working debug) ----------
def ensure_rgb!(img)
  begin img.colorspace = Magick::RGBColorspace rescue nil end
  img
end

def transparent_canvas(w, h)
  img = Magick::Image.new(w, h) { |i| i.background_color = 'none' }
  begin
    img.alpha(Magick::ActivateAlphaChannel)
  rescue
    img.matte = true
  end
  begin
    img.colorspace = Magick::RGBColorspace
  rescue
  end
  img
end

def px255(r, g, b)
  q = Magick::QuantumRange.to_f
  Pixel.new((r/255.0*q).round, (g/255.0*q).round, (b/255.0*q).round)
end

def pick_font(img, candidates)
  d = Draw.new
  candidates.each do |name|
    begin
      d.font = name
      m = d.get_type_metrics(img, "A")
      return name if m && m.width > 0
    rescue
    end
  end
  nil
end

def annotate_centered!(img, x, y, text, fill_pixel, font, size)
  d = Draw.new
  # d.font = font if font
  d.font = "DejaVu-Sans-Mono"
  d.pointsize = size
  d.gravity = Magick::NorthWestGravity
  d.text_antialias = true
  d.stroke = "none"
  d.fill = fill_pixel
  m = d.get_type_metrics(img, text)
  cx = x - m.width / 2.0
  cy = y + (m.ascent - m.descent) / 2.0
  d.annotate(img, 0, 0, cx, cy, text)
end

def clamp01(v) [[v,0.0].max, 1.0].min end
def lerp(a,b,t) a + (b - a) * t end

# Tail gradient: step=1..len-1 (1 just under head), vivid → darker green
# def tail_px(step, len)
#   # t = (step - 1).to_f / [len - 1, 1].max     # 0..1
#   # g = (lerp(255.0,  70.0, t)).round
#   # r = (lerp( 60.0,   0.0, t)).round
#   # b = r
#   # px255(r, g, b)
#
#   t = (step - 1).to_f / [len - 1, 1].max
#   h = 40                    # warm hue
#   s = 1.0
#   v = (1.0 - 0.8 * t)       # fade brightness down the tail
#   rgb = hsv_to_rgb(h, s, v) # simple helper converting HSV→RGB
#   px255(*rgb)
# end

def tail_px(step, len)
  # step = 1..len-1 (1 just under the head)
  t = (step - 1).to_f / [len - 1, 1].max        # 0..1 along the tail
  h, s, v = 40.0, 1.0, 1.0 - 0.1 * t            # amber hue, little brightness fade
  r, g, b = hsv_to_rgb(h, s, v)
  q = Magick::QuantumRange
  alpha = (q * t).round                         # alpha increases down the tail (more transparent)
  px = Magick::Pixel.new((r/255.0*q).round, (g/255.0*q).round, (b/255.0*q).round, alpha)
  px
end

# # palette options: :chartreuse (zingy green) or :cyan (cool electric)
# def tail_px(step, len, palette: :cyan)
#   t = (step - 1).to_f / [len - 1, 1].max               # 0..1 along the tail (0 near head)
#
#   # easing helpers (non-linear feels livelier)
#   ease_alpha = t**1.6                                   # faster transparency falloff
#   ease_val   = 1.0 - 0.35 * (t**1.2)                    # bright head, darker tail
#   ease_sat   = 1.0 - 0.15 * (t**0.8)                    # keep saturation, taper a hair
#
#   case palette
#   when :chartreuse
#     base_h = 78.0   # green-yellow pop
#     drift  = -8.0   # a touch greener down the tail
#   when :cyan
#     base_h = 195.0  # strong contrast to warm landscape
#     drift  = +6.0   # slight toward blue down the tail
#   else
#     base_h = 40.0   # your original amber, but with better curves
#     drift  = 0.0
#   end
#
#   h = base_h + drift * t
#   s = [[ease_sat, 0.0].max, 1.0].min
#   v = [[ease_val, 0.0].max, 1.0].min
#
#   r, g, b = hsv_to_rgb(h, s, v)
#
#   q     = Magick::QuantumRange
#   alpha = (q * ease_alpha).round                       # 0=opaque (head), q=transparent (tail)
#
#   Magick::Pixel.new((r/255.0*q).round, (g/255.0*q).round, (b/255.0*q).round, alpha)
# end


# Deterministic RNG per cell/frame (so the loop repeats exactly)
def rand_for(r, c, frame, salt, prob)
  seed = Digest::SHA1.hexdigest("#{salt}|#{r}|#{c}|#{frame}").to_i(16) & 0x7fffffff
  Random.new(seed).rand < prob
end
# ----------------------------------------------------------------

# Layout
x_step = CANVAS_W.to_f / COLS
y_step = CANVAS_H.to_f / ROWS
centers_x = (0...COLS).map { |c| (x_step / 2.0) + c * x_step }
centers_y = (0...ROWS).map { |r| (y_step / 2.0) + (r-1) * y_step + y_step / 10.0 }
# FONT_SIZE = (y_step * 1.08).round
FONT_SIZE = (H / ROWS) * 0.9

# Characters (latin + half-width kana; kana duplicated)
# latin = "-><=*|\":АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ0123456789"
# kana  = (65393..65437).to_a.pack('U*')
# CHARS = (latin + kana + kana).chars
CHARS = ":=?_→←↔↦λ¬∧∨∀∃≤≥≠∘⦃⦄⟦⟧∈⊆⊂⊥⊤⊓⊔∑∏!".chars

NCHAR = CHARS.length

# Base glyphs per cell (these scroll); we’ll flicker near the head on top
base_letters = Array.new(ROWS) { |i| Array.new(COLS) { |j| CHARS.sample } } #[(i+j+rand(4)) % CHARS.length] } }
base_letters=base_letters.transpose
base_letters=base_letters.collect { |cols|
  set=[cols[0]]
  1.upto(cols.length-1) { |k|
    while cols[k] == cols[k-1] do
      cols[k]=CHARS.sample
    end
    set << cols[k]
  }
  set
}.transpose

# Font
scratch = transparent_canvas(10,10)
FONT = pick_font(scratch, FONT_CANDIDATES)
puts "Font: #{FONT.inspect}"

col_terminate=Array.new(COLS) { |i| ROWS/3 + rand(ROWS/3) }

white_px     = px255(255, 176, 0)
white_px     = px255(255, 240, 176)
full_green   = px255(0,255,0)
bg_green_px  = px255(0, BG_GREEN, 0)

# Per-column parameters (fixed across the loop → seamless)
head_start   = Array.new(COLS) { rand(0...ROWS) }                 # starting head row
2.upto(head_start.length-2) { |i|
  while head_start[i] == head_start[i+1] or head_start[i] == head_start[i-1] do
    head_start[i]=head_start[i]+(rand(2) == 0 ? 1 : -1)
  end
}

streak_len   = Array.new(COLS) { rand(STREAK_MIN..STREAK_MAX) }   # tail length + head
# (you can also randomize a faint per-column "always-on" chance if you like)

Parallel.map(Array.new(FRAME_COUNT) { |i| i }, :in_processes=>10) { |frame|
  img = transparent_canvas(CANVAS_W, CANVAS_H)

  ROWS.times do |r|
    COLS.times do |c|
      if r <= col_terminate[c] then
      
          # 1) Scroll characters: pick source row that has moved down by `frame`
          src_r = (r - frame) % ROWS
          ch    = base_letters[src_r][c]

          # Optional faint background glyphs outside streak
          if rand_for(r, c, frame % ROWS, "bg", DRAW_BG_PROB)
            annotate_centered!(img, centers_x[c], centers_y[r], ch, bg_green_px, FONT, FONT_SIZE)
          end

          # 2) Head / tail for this column at this frame
          head = (head_start[c] + frame) % ROWS
          len  = streak_len[c]            # >= STREAK_MIN

          # distance below head with wrap: 0=head, 1..ROWS-1 = rows below
          dist = (r - head) % ROWS

          if dist == 0
            # 3) bright head (white) — flicker the glyph right at the head sometimes
            if rand_for(r, c, frame, "head_flicker", FLICKER_PROB)
              ch = CHARS.sample
            end
            annotate_centered!(img, centers_x[c], centers_y[r], ch, white_px, FONT, FONT_SIZE)

          elsif dist <= (len - 1)
            # 4) inside tail: vivid → dark green; also flicker near head
            if dist <= FLICKER_ZONE && rand_for(r, c, frame, "tail_flicker", FLICKER_PROB)
              ch = CHARS.sample
            end
            annotate_centered!(img, centers_x[c], centers_y[r], ch, tail_px(dist, len), FONT, FONT_SIZE)

          else
            # 5) outside streak: usually nothing (maybe faint BG glyph already drawn above)
            # do nothing
          end
      end
    end
  end

  path = File.join(OUT_DIR, format("frame_%04d.png", frame + 1))
  img.write(path)
  puts "Saved #{path}"
}


puts "\n✅ Wrote #{FRAME_COUNT} transparent frames to #{OUT_DIR}/"
puts "Import as layers in GIMP/PS; set frame delay (e.g., 0.06s). Loop is seamless after #{ROWS} frames."
