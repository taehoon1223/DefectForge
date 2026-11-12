"""2-D Perlin (gradient) noise drawn from the request's numpy Generator, so results follow the seed."""

from __future__ import annotations

import math

import numpy as np


def _fade(t: np.ndarray) -> np.ndarray:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def perlin(rng: np.random.Generator, shape_hw: tuple[int, int], cells: int) -> np.ndarray:
    """Gradient noise with ``cells`` lattice cells across each side, roughly in [-1, 1] (float32)."""
    h, w = shape_hw
    angles = rng.uniform(0.0, 2.0 * math.pi, size=(cells + 1, cells + 1))
    gx, gy = np.cos(angles), np.sin(angles)
    ys = (np.arange(h) + 0.5) / h * cells
    xs = (np.arange(w) + 0.5) / w * cells
    yi = np.minimum(ys.astype(np.int64), cells - 1)[:, None]
    xi = np.minimum(xs.astype(np.int64), cells - 1)[None, :]
    fy = (ys[:, None] - yi).astype(np.float64)
    fx = (xs[None, :] - xi).astype(np.float64)

    def corner(dy: int, dx: int) -> np.ndarray:
        return gx[yi + dy, xi + dx] * (fx - dx) + gy[yi + dy, xi + dx] * (fy - dy)

    u, v = _fade(fx), _fade(fy)
    top = corner(0, 0) + u * (corner(0, 1) - corner(0, 0))
    bottom = corner(1, 0) + u * (corner(1, 1) - corner(1, 0))
    return ((top + v * (bottom - top)) * math.sqrt(2.0)).astype(np.float32)


def fractal(rng: np.random.Generator, shape_hw: tuple[int, int], cells: int) -> np.ndarray:
    """Two octaves of Perlin noise, roughly in [-1, 1]."""
    return (perlin(rng, shape_hw, cells) + 0.5 * perlin(rng, shape_hw, cells * 2)) / np.float32(1.5)
