/**
 * 手写 SVG 图表。没有图表库，坐标全部按实际像素算，文字不会被拉伸。
 * 每个函数都返回一个 <svg> 元素，宽度由调用方决定；窗口 resize 时重新渲染。
 */

const NS = "http://www.w3.org/2000/svg";

export function svgEl(name, attrs = {}, children = []) {
  const el = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    el.setAttribute(key, String(value));
  }
  for (const child of children) el.appendChild(child);
  return el;
}

function textEl(x, y, text, options = {}) {
  return svgEl("text", {
    x,
    y,
    fill: options.fill || "currentColor",
    "font-size": options.size || 11,
    "font-family": options.mono ? "var(--mono)" : "var(--sans)",
    "text-anchor": options.anchor || "start",
    "dominant-baseline": options.baseline || "auto",
    "font-weight": options.weight || 400
  }, [document.createTextNode(text)]);
}

export function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * base;
}

function clockLabel(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/**
 * 请求量时间轴：总量面积图 + 错误量叠加。
 */
export function createTimelineChart({ buckets, width, height, colors, formatCompact, formatClock }) {
  const margin = { top: 16, right: 14, bottom: 26, left: 46 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const top = niceMax(maxCount);
  const svg = svgEl("svg", {
    width,
    height,
    viewBox: "0 0 " + width + " " + height,
    role: "img",
    "aria-label": "请求量时间轴"
  });

  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", { id: "tl-fill", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.appendChild(svgEl("stop", { offset: "0%", "stop-color": colors.accent, "stop-opacity": "0.42" }));
  gradient.appendChild(svgEl("stop", { offset: "100%", "stop-color": colors.accent, "stop-opacity": "0.02" }));
  defs.appendChild(gradient);
  svg.appendChild(defs);

  const x = (i) => margin.left + (buckets.length <= 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
  const y = (value) => margin.top + innerH - (value / top) * innerH;

  for (let tick = 0; tick <= 4; tick++) {
    const value = (top / 4) * tick;
    const yy = y(value);
    svg.appendChild(svgEl("line", {
      x1: margin.left, y1: yy, x2: margin.left + innerW, y2: yy,
      stroke: colors.grid, "stroke-width": 1, "stroke-dasharray": tick === 0 ? "0" : "3 4"
    }));
    svg.appendChild(textEl(margin.left - 9, yy + 4, formatCompact(value), {
      fill: colors.faint, size: 10.5, anchor: "end", mono: true
    }));
  }

  if (buckets.length) {
    const stepWidth = buckets.length > 1 ? innerW / (buckets.length - 1) : innerW;
    const areaPath = ["M", x(0), margin.top + innerH];
    for (let i = 0; i < buckets.length; i++) areaPath.push("L", x(i), y(buckets[i].count));
    areaPath.push("L", x(buckets.length - 1), margin.top + innerH, "Z");
    svg.appendChild(svgEl("path", { d: areaPath.join(" "), fill: "url(#tl-fill)" }));

    const linePath = buckets.map((bucket, i) => (i === 0 ? "M" : "L") + " " + x(i) + " " + y(bucket.count)).join(" ");
    svg.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: colors.accent, "stroke-width": 1.8, "stroke-linejoin": "round" }));

    const errorSeries = buckets.filter((bucket) => bucket.errors > 0);
    if (errorSeries.length) {
      const errorPath = buckets.map((bucket, i) => (i === 0 ? "M" : "L") + " " + x(i) + " " + y(bucket.errors)).join(" ");
      svg.appendChild(svgEl("path", {
        d: errorPath, fill: "none", stroke: colors.bad, "stroke-width": 1.3,
        "stroke-opacity": 0.85, "stroke-linejoin": "round"
      }));
    }

    const slot = Math.max(2, stepWidth * 0.62);
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      const rect = svgEl("rect", {
        x: x(i) - slot / 2, y: margin.top, width: slot, height: innerH, fill: "transparent"
      });
      const title = svgEl("title");
      title.appendChild(document.createTextNode(
        formatClock(bucket.t) + " · " + bucket.count + " 次请求" + (bucket.errors ? " · " + bucket.errors + " 个错误" : "")
      ));
      rect.appendChild(title);
      svg.appendChild(rect);
    }

    const labelCount = Math.max(2, Math.min(6, Math.floor(innerW / 90), buckets.length));
    for (let i = 0; i < labelCount; i++) {
      const index = Math.round((i / (labelCount - 1 || 1)) * (buckets.length - 1));
      svg.appendChild(textEl(x(index), margin.top + innerH + 17, clockLabel(buckets[index].t), {
        fill: colors.faint, size: 10.5, anchor: i === 0 ? "start" : i === labelCount - 1 ? "end" : "middle", mono: true
      }));
    }
  }

  return svg;
}

/**
 * 状态分布甜甜圈。用 stroke-dasharray 画环，简单又清晰。
 */
export function createDonutChart({ slices, size = 168, thickness = 20, colors, centerLabel, centerValue }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, role: "img", "aria-label": "状态码分布" });

  svg.appendChild(svgEl("circle", {
    cx, cy, r: radius, fill: "none", stroke: colors.grid, "stroke-width": thickness
  }));

  let offset = 0;
  const gap = 2;
  for (const slice of slices) {
    if (!slice.value) continue;
    const length = (slice.value / total) * circumference;
    const visible = Math.max(0.5, length - gap);
    const circle = svgEl("circle", {
      cx, cy, r: radius, fill: "none",
      stroke: slice.color,
      "stroke-width": thickness,
      "stroke-dasharray": visible + " " + (circumference - visible),
      "stroke-dashoffset": -(offset + gap / 2),
      "stroke-linecap": "butt",
      transform: "rotate(-90 " + cx + " " + cy + ")"
    });
    const title = svgEl("title");
    title.appendChild(document.createTextNode(slice.label + "：" + slice.value));
    circle.appendChild(title);
    svg.appendChild(circle);
    offset += length;
  }

  if (centerValue !== undefined) {
    svg.appendChild(textEl(cx, cy - 2, centerValue, {
      fill: colors.text, size: 20, anchor: "middle", weight: 650
    }));
    svg.appendChild(textEl(cx, cy + 16, centerLabel || "", {
      fill: colors.faint, size: 10.5, anchor: "middle"
    }));
  }

  return svg;
}

/**
 * 延迟直方图：竖柱 + 顶部数值。
 */
export function createColumnChart({ items, width, height, colors, formatCompact, unit }) {
  const margin = { top: 20, right: 8, bottom: 30, left: 34 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);
  const maxCount = Math.max(1, ...items.map((item) => item.count));
  const top = niceMax(maxCount);
  const svg = svgEl("svg", { width, height, viewBox: "0 0 " + width + " " + height, role: "img", "aria-label": "延迟直方图" });

  for (let tick = 0; tick <= 3; tick++) {
    const value = (top / 3) * tick;
    const yy = margin.top + innerH - (value / top) * innerH;
    svg.appendChild(svgEl("line", {
      x1: margin.left, y1: yy, x2: margin.left + innerW, y2: yy,
      stroke: colors.grid, "stroke-width": 1, "stroke-dasharray": tick === 0 ? "0" : "3 4"
    }));
    svg.appendChild(textEl(margin.left - 7, yy + 4, formatCompact(value), {
      fill: colors.faint, size: 10.5, anchor: "end", mono: true
    }));
  }

  const band = innerW / items.length;
  const barWidth = Math.max(4, band * 0.58);
  const showValue = band >= 26;
  const labelEvery = band < 42 && items.length > 5 ? 2 : 1;
  items.forEach((item, i) => {
    const h = (item.count / top) * innerH;
    const x = margin.left + band * i + (band - barWidth) / 2;
    const y = margin.top + innerH - h;
    const rect = svgEl("rect", {
      x, y, width: barWidth, height: Math.max(1, h), rx: 3,
      fill: colors.accent, "fill-opacity": 0.55
    });
    const title = svgEl("title");
    title.appendChild(document.createTextNode(item.label + "：" + item.count + (unit ? " " + unit : "")));
    rect.appendChild(title);
    svg.appendChild(rect);
    if (item.count > 0 && showValue) {
      svg.appendChild(textEl(x + barWidth / 2, y - 6, formatCompact(item.count), {
        fill: colors.muted, size: 10, anchor: "middle", mono: true
      }));
    }
    if (i % labelEvery === 0) {
      svg.appendChild(textEl(x + barWidth / 2, margin.top + innerH + 18, item.label.replace(" ms", ""), {
        fill: colors.faint, size: 9.5, anchor: "middle", mono: true
      }));
    }
  });

  return svg;
}
