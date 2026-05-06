// Requires:
//   core.Observable

core.namespace( 'ross.drawing.canvas_helpers', function(ns){
  "use strict";

  function deepMerge(target, source){
    if(source == null || typeof source !== 'object') return target;
    for(const key of Object.keys(source)){
      const sv = source[key];
      if(sv && typeof sv === 'object' && !Array.isArray(sv)){
        if(!target[key] || typeof target[key] !== 'object') target[key] = {};
        deepMerge(target[key], sv);
      } else {
        target[key] = sv;
      }
    }
    return target;
  }

  /**
   * Adds matrix-aware transform tracking to a 2D canvas context.
   * @param   {CanvasRenderingContext2D} ctx
   */
  function track_transforms( ctx ) {
    if( ctx.transformedPoint ) return;

    var xform = matrix.identity(3);

    // x-scale specifically
    // y-scale would use c and d and shortcut if c was zero.
    ctx.getScale = function(){
      var a=xform[0][0],b=xform[1][0];
      if(!b)return a;
      return Math.sqrt(a * a + b * b);
    };

    // sets UNIFORM scale preserving screen centering.
    ctx.setScale = function(s){
      var os = ctx.getScale();
      var c = ctx.getCenter();
      var f = s / os;
      if(f !== 1) {
        ctx.translate(c.x, c.y);
        ctx.scale(f, f);
        ctx.translate(-c.x, -c.y);
        ctx.scale_changed_event.trigger(s, os);
      }
    };

    // center coords in WORLD space.
    ctx.getCenter = function(){
      return ctx.transformedPoint(ctx.width/2, ctx.height/2);
    };

    // sets the point in WORLD space to the center of the canvas
    ctx.setCenter = function(x, y){
      var c = ctx.getCenter();
      ctx.translate(c.x, c.y);
      ctx.translate(-x, -y);
    };

    // Bounding BOX (4 corners) in WORLD space in clockwise order.
    ctx.getViewBounds = function(){
      return [
        ctx.transformedPoint(0, 0),
        ctx.transformedPoint(ctx.width, 0),
        ctx.transformedPoint(ctx.width, ctx.height),
        ctx.transformedPoint(0, ctx.height)
      ];
    };

    ctx.getTransform = function(){
      var t = xform;
      return {
        a: t[0][0],
        b: t[1][0],
        c: t[0][1],
        d: t[1][1],
        e: t[0][2],
        f: t[1][2],
      };
    };

    ctx.identity = function(){
      ctx.setTransformMatrix(matrix.identity(3));
    };

    ctx.getTransformMatrix = function(){ return xform; };
    ctx.setTransformMatrix = function(m){
      xform = matrix.translate(m,0,0);
      ctx._syncTransforms();
    };

    var savedTransforms = [];
    var save = ctx.save;
    ctx.save = function(){
      savedTransforms.push(matrix.translate(xform,0,0));
      return save.call(ctx);
    };
    var restore = ctx.restore;
    ctx.restore = function(){
      xform = savedTransforms.pop();
      var ret = restore.call(ctx);
      ctx._syncTransforms();
      return ret;
    };

    var scale = ctx.scale;
    ctx.scale = function(sx,sy){
      if(sy===undefined)sy=sx;
      xform = matrix.scale(xform,sx,sy);
      return scale.call(ctx,sx,sy);
    };
    var rotate = ctx.rotate;
    ctx.rotate = function(radians){
      xform = matrix.rotate(xform,radians);
      return rotate.call(ctx,radians);
    };
    var translate = ctx.translate;
    ctx.translate = function(dx,dy){
      xform = matrix.translate(xform,dx,dy);
      return translate.call(ctx,dx,dy);
    };
    var transform = ctx.transform;
    ctx.transform = function(a,b,c,d,e,f){
      var m2 = matrix.identity(3);
      m2[0][0] = a; m2[1][0] = b;
      m2[0][1] = c; m2[1][1] = d;
      m2[0][2] = e; m2[1][2] = f;
      xform = matrix.multiply(xform,m2);
      return transform.call(ctx,a,b,c,d,e,f);
    };
    var setTransform = ctx.setTransform;
    ctx.setTransform = function(a,b,c,d,e,f){
      var m2 = matrix.identity(3);
      if(typeof(a) == 'object'){
        m2[0][0] = a.a; m2[1][0] = a.b;
        m2[0][1] = a.c; m2[1][1] = a.d;
        m2[0][2] = a.e; m2[1][2] = a.f;
        xform = m2;
        return setTransform.call(ctx,a,b,c,d,e,f);
      } else {
        m2[0][0] = a; m2[1][0] = b;
        m2[0][1] = c; m2[1][1] = d;
        m2[0][2] = e; m2[1][2] = f;
        xform = m2;
        return setTransform.call(ctx,a,b,c,d,e,f);
      }
    };

    // Maps from screen to world cords.
    ctx.transformedPoint = function(x,y){
      var mi = matrix.inverse(xform);
      return matrix.transformPoint(mi, x, y);
    };

    // Maps from world to screen cords.
    ctx.untransformedPoint = function(x,y){
      return matrix.transformPoint(xform, x, y);
    };

    ctx._syncTransforms = function() {
      var t = ctx.getTransform();
      setTransform.call(ctx, t.a, t.b, t.c, t.d, t.e, t.f);
    };
  }

  function localPoint(canvas_dom, evt){
    if(typeof evt.offsetX === 'number') return { x: evt.offsetX, y: evt.offsetY };
    var rect = canvas_dom.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  function fireEvent(canvas_dom, canvas_ctx, handler, evt){
    if(!handler.hasSubscribers()) return;
    var p = localPoint(canvas_dom, evt);
    handler.trigger(
      canvas_ctx.transformedPoint(p.x, p.y),
      {
        button: evt.button,
        wheelDelta: evt.wheelDelta,
        deltaY: evt.deltaY,
        ctrlKey: evt.ctrlKey,
        shiftKey: evt.shiftKey,
        altKey: evt.altKey,
        metaKey: evt.metaKey,
        detail: evt.detail,
        pointerType: evt.pointerType
      }
    );
  }

  /**
   * Legacy: mouse-only zoom + drag. Kept for backwards compatibility with
   * existing consumers that opt out of pointer input.
   */
  function enable_mouse_zoom( canvas_dom, canvas_ctx, redraw, options ){
    const default_options = {
      pan_with_mouse_button_mask: 0x05,
      prevent_browser_scroll_on_pan_with_mouse: true,
      scale_factor: 1.1,
      min_scale: 0.000001,
      max_scale: 100,
    };
    options = deepMerge(deepMerge({}, default_options), options || {});
    track_transforms( canvas_ctx );
    var lastX=canvas_dom.width/2, lastY=canvas_dom.height/2;
    var dragStart;

    if(options.prevent_browser_scroll_on_pan_with_mouse){
      var mouse_over_canvas = false;
      document.body.addEventListener('mousedown', function(evt){
        if(evt.button === 1 && mouse_over_canvas) evt.preventDefault();
      });
      canvas_dom.addEventListener('mouseover', function(){ mouse_over_canvas = true; });
      canvas_dom.addEventListener('mouseout',  function(){ mouse_over_canvas = false; });
    }

    canvas_dom.addEventListener('click', function(evt){
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mouseclick_event, evt);
    });
    canvas_dom.addEventListener('dblclick', function(evt){
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedblclick_event, evt);
    });

    canvas_dom.addEventListener('mousedown', function(evt){
      if(evt.buttons & options.pan_with_mouse_button_mask){
        var p = localPoint(canvas_dom, evt);
        lastX = p.x; lastY = p.y;
        dragStart = canvas_ctx.transformedPoint(lastX,lastY);
      }
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedown_event, evt);
    });
    canvas_dom.addEventListener('mousemove', function(evt){
      var p = localPoint(canvas_dom, evt);
      lastX = p.x; lastY = p.y;
      var pt = canvas_ctx.transformedPoint(lastX,lastY);
      if (dragStart && (evt.buttons & options.pan_with_mouse_button_mask)){
        canvas_ctx.translate(pt.x-dragStart.x, pt.y-dragStart.y);
        canvas_ctx._syncTransforms();
        if(redraw) redraw();
      } else {
        dragStart = null;
      }
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousemove_event, evt);
    });
    canvas_dom.addEventListener('mouseup', function(evt){
      if(evt.buttons & options.pan_with_mouse_button_mask) dragStart = null;
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mouseup_event, evt);
    });

    var zoom = function(clicks){
      var current_scale = canvas_ctx.getScale();
      var pt = canvas_ctx.transformedPoint(lastX,lastY);
      canvas_ctx.translate(pt.x,pt.y);
      var factor = Math.pow(options.scale_factor,clicks);
      if(factor * current_scale > options.max_scale) factor = options.max_scale / current_scale;
      else if(factor * current_scale < options.min_scale) factor = options.min_scale / current_scale;
      canvas_ctx.scale(factor,factor);
      canvas_ctx.translate(-pt.x,-pt.y);
      canvas_ctx._syncTransforms();
      canvas_ctx.scale_changed_event.trigger(canvas_ctx.getScale(), current_scale);
      if(redraw) redraw();
    };

    canvas_dom.addEventListener('wheel', function(evt){
      evt.preventDefault();
      // Normalize across delta modes (px/line/page) and old wheelDelta.
      var delta = 0;
      if(typeof evt.deltaY === 'number' && evt.deltaY !== 0){
        delta = -evt.deltaY / (evt.deltaMode === 1 ? 3 : evt.deltaMode === 2 ? 30 : 100);
        delta *= 3;
      } else if(evt.wheelDelta){
        delta = evt.wheelDelta / 40;
      }
      if(delta) zoom(delta);
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousewheel_event, evt);
    }, { passive: false });
  }

  /**
   * Pointer-events based input: unifies mouse/pen/touch.
   * - Single pointer drag = pan
   * - Two-pointer gesture = pinch-zoom + two-finger pan
   * - Wheel = zoom (synthesized via the standard `wheel` event)
   * - Two quick taps within 300ms / 25px = synthetic dblclick (opt-in)
   */
  function enable_pointer_input( canvas_dom, canvas_ctx, redraw, options ){
    const default_options = {
      scale_factor: 1.1,
      min_scale: 0.000001,
      max_scale: 100,
      // Mouse button mask for drag-pan (kept for desktop parity).
      pan_with_mouse_button_mask: 0x05,
      // Synthesize a mousedblclick_event from two quick touch taps.
      // Off by default — phantom double-taps during pan/zoom are usually unwanted.
      synthesize_touch_dblclick: false,
      double_tap_ms: 300,
      double_tap_px: 25,
    };
    options = deepMerge(deepMerge({}, default_options), options || {});

    track_transforms( canvas_ctx );

    // Stop the browser from claiming touch gestures.
    canvas_dom.style.touchAction = 'none';

    var pointers = new Map();   // pointerId -> {x, y}
    var lastX = canvas_dom.width/2, lastY = canvas_dom.height/2;
    var dragStart = null;        // world-space anchor for single-pointer pan
    var pinchPrev = null;        // { dist, mid: {x,y} } in screen space

    var lastTap = { t: 0, x: 0, y: 0 };

    function updatePointer(evt){
      var p = localPoint(canvas_dom, evt);
      pointers.set(evt.pointerId, p);
      lastX = p.x; lastY = p.y;
      return p;
    }

    function pinchSnapshot(){
      if(pointers.size < 2) return null;
      var it = pointers.values();
      var a = it.next().value;
      var b = it.next().value;
      var dx = b.x - a.x, dy = b.y - a.y;
      return {
        dist: Math.sqrt(dx*dx + dy*dy),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      };
    }

    function clampZoomFactor(factor, current_scale){
      if(factor * current_scale > options.max_scale) return options.max_scale / current_scale;
      if(factor * current_scale < options.min_scale) return options.min_scale / current_scale;
      return factor;
    }

    function zoomAt(screenX, screenY, factor){
      var current_scale = canvas_ctx.getScale();
      var pt = canvas_ctx.transformedPoint(screenX, screenY);
      factor = clampZoomFactor(factor, current_scale);
      canvas_ctx.translate(pt.x, pt.y);
      canvas_ctx.scale(factor, factor);
      canvas_ctx.translate(-pt.x, -pt.y);
      canvas_ctx._syncTransforms();
      canvas_ctx.scale_changed_event.trigger(canvas_ctx.getScale(), current_scale);
    }

    function panBy(screenDx, screenDy){
      // Convert a screen-space delta into world-space using the current transform.
      var a = canvas_ctx.transformedPoint(0, 0);
      var b = canvas_ctx.transformedPoint(screenDx, screenDy);
      canvas_ctx.translate(b.x - a.x, b.y - a.y);
      canvas_ctx._syncTransforms();
    }

    canvas_dom.addEventListener('pointerdown', function(evt){
      // For mouse, only start pan if a configured button is pressed.
      if(evt.pointerType === 'mouse' && !(evt.buttons & options.pan_with_mouse_button_mask)){
        // Still record so downstream subscribers see mousedown_event.
        fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedown_event, evt);
        return;
      }
      canvas_dom.setPointerCapture(evt.pointerId);
      var p = updatePointer(evt);
      if(pointers.size === 1){
        dragStart = canvas_ctx.transformedPoint(p.x, p.y);
        pinchPrev = null;
      } else if(pointers.size === 2){
        dragStart = null;
        pinchPrev = pinchSnapshot();
      }
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedown_event, evt);
    });

    canvas_dom.addEventListener('pointermove', function(evt){
      var hadPointer = pointers.has(evt.pointerId);
      var p = localPoint(canvas_dom, evt);
      lastX = p.x; lastY = p.y;

      if(hadPointer){
        pointers.set(evt.pointerId, p);

        if(pointers.size >= 2 && pinchPrev){
          var snap = pinchSnapshot();
          if(snap && pinchPrev.dist > 0){
            var factor = snap.dist / pinchPrev.dist;
            // Pan by midpoint movement (screen space), then zoom around new midpoint.
            panBy(snap.mid.x - pinchPrev.mid.x, snap.mid.y - pinchPrev.mid.y);
            if(factor !== 1) zoomAt(snap.mid.x, snap.mid.y, factor);
            pinchPrev = snap;
            if(redraw) redraw();
          }
        } else if(pointers.size === 1 && dragStart){
          // Pan: keep the world-space anchor under the finger.
          if(evt.pointerType !== 'mouse' || (evt.buttons & options.pan_with_mouse_button_mask)){
            var pt = canvas_ctx.transformedPoint(p.x, p.y);
            canvas_ctx.translate(pt.x - dragStart.x, pt.y - dragStart.y);
            canvas_ctx._syncTransforms();
            if(redraw) redraw();
          } else {
            dragStart = null;
          }
        }
      }

      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousemove_event, evt);
    });

    function endPointer(evt){
      var was_tracked = pointers.delete(evt.pointerId);
      if(pointers.size < 2) pinchPrev = null;
      if(pointers.size === 0) dragStart = null;
      else if(pointers.size === 1){
        // Re-anchor remaining single pointer for clean pan continuation.
        var it = pointers.values();
        var only = it.next().value;
        dragStart = canvas_ctx.transformedPoint(only.x, only.y);
      }
      try { canvas_dom.releasePointerCapture(evt.pointerId); } catch(_){}
      return was_tracked;
    }

    canvas_dom.addEventListener('pointerup', function(evt){
      var was_tracked = endPointer(evt);
      // Synthetic double-tap for touch (mouse already gets native dblclick).
      if(was_tracked && evt.pointerType === 'touch' && options.synthesize_touch_dblclick){
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        var dx = lastX - lastTap.x, dy = lastY - lastTap.y;
        if(now - lastTap.t < options.double_tap_ms && Math.hypot(dx, dy) < options.double_tap_px){
          fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedblclick_event, evt);
          lastTap = { t: 0, x: 0, y: 0 };
        } else {
          lastTap = { t: now, x: lastX, y: lastY };
        }
      }
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mouseup_event, evt);
    });
    canvas_dom.addEventListener('pointercancel', function(evt){
      endPointer(evt);
    });
    canvas_dom.addEventListener('lostpointercapture', function(evt){
      endPointer(evt);
    });

    // Native click/dblclick still fire for mouse.
    canvas_dom.addEventListener('click', function(evt){
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mouseclick_event, evt);
    });
    canvas_dom.addEventListener('dblclick', function(evt){
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousedblclick_event, evt);
    });

    canvas_dom.addEventListener('wheel', function(evt){
      evt.preventDefault();
      var delta = 0;
      if(typeof evt.deltaY === 'number' && evt.deltaY !== 0){
        delta = -evt.deltaY / (evt.deltaMode === 1 ? 3 : evt.deltaMode === 2 ? 30 : 100);
        delta *= 3;
      } else if(evt.wheelDelta){
        delta = evt.wheelDelta / 40;
      }
      if(delta){
        var p = localPoint(canvas_dom, evt);
        lastX = p.x; lastY = p.y;
        var current_scale = canvas_ctx.getScale();
        zoomAt(p.x, p.y, Math.pow(options.scale_factor, delta));
        if(redraw && canvas_ctx.getScale() !== current_scale) redraw();
      }
      fireEvent(canvas_dom, canvas_ctx, canvas_ctx.mousewheel_event, evt);
    }, { passive: false });
  }

  function initCanvas( selector, draw_handler, options ) {
    const default_options = {
      enable_pointer_input: true,
      enable_mouse_zoom: false,    // legacy path; defaults off when pointer input is on
      default_scale: 1,
      flip_x: false,
      flip_y: true,
      center_zero_zero: true,
      enable_responsive_resize: true,
      mouse_zoom_options: {},
      // Alias for clarity. mouse_zoom_options is still respected.
      zoom_options: {}
    };
    options = deepMerge(deepMerge({}, default_options), options || {});

    var canvas_dom = (typeof selector === 'string')
      ? document.querySelector(selector)
      : (selector && selector.jquery ? selector.get(0) : selector);
    var canvas_ctx = canvas_dom.getContext("2d");
    canvas_ctx.redraw = draw_handler;

    Object.defineProperty(canvas_ctx, 'height', {
      get: function() { return canvas_dom.height; },
      set: function(v){ canvas_dom.height = v; }
    });
    Object.defineProperty(canvas_ctx, 'width', {
      get: function() { return canvas_dom.width; },
      set: function(v){ canvas_dom.width = v; }
    });

    canvas_ctx.width  = canvas_dom.clientWidth  || canvas_dom.width;
    canvas_ctx.height = canvas_dom.clientHeight || canvas_dom.height;

    if(options.enable_responsive_resize) {
      var resize = function(){
        var w = canvas_dom.clientWidth | 0;
        var h = canvas_dom.clientHeight | 0;
        if(canvas_ctx.width != w || canvas_ctx.height != h){
          canvas_ctx.width = w;
          canvas_ctx.height = h;
          canvas_ctx.redraw();
        }
      };
      window.addEventListener('resize', resize);
      if(typeof ResizeObserver !== 'undefined'){
        var ro = new ResizeObserver(resize);
        ro.observe(canvas_dom);
      }
    }

    canvas_ctx.mousemove_event     = new core.Observable(canvas_ctx);
    canvas_ctx.mouseup_event       = new core.Observable(canvas_ctx);
    canvas_ctx.mousedown_event     = new core.Observable(canvas_ctx);
    canvas_ctx.mouseclick_event    = new core.Observable(canvas_ctx);
    canvas_ctx.mousedblclick_event = new core.Observable(canvas_ctx);
    canvas_ctx.mousewheel_event    = new core.Observable(canvas_ctx);
    canvas_ctx.scale_changed_event = new core.Observable(canvas_ctx);

    // Merge zoom_options aliases into mouse_zoom_options.
    var zoomOpts = deepMerge(deepMerge({}, options.mouse_zoom_options || {}), options.zoom_options || {});

    if(options.enable_pointer_input){
      enable_pointer_input(canvas_dom, canvas_ctx, draw_handler, zoomOpts);
    } else if(options.enable_mouse_zoom){
      enable_mouse_zoom(canvas_dom, canvas_ctx, draw_handler, zoomOpts);
    } else {
      track_transforms(canvas_ctx);
    }

    canvas_ctx.resetTransforms = function(do_redraw){
      var s = options.default_scale || 1;
      canvas_ctx.identity();
      if(options.center_zero_zero)
        canvas_ctx.translate( (canvas_ctx.width / 2|0) + 0.5, (canvas_ctx.height / 2|0) + 0.5 );

      var os = canvas_ctx.getScale();
      canvas_ctx.scale((options.flip_x ? -s : s),(options.flip_y ? -s : s));
      canvas_ctx.scale_changed_event.trigger(s, os);
      if(do_redraw) canvas_ctx.redraw();
    };

    canvas_ctx.resetTransforms();

    var fillText = canvas_ctx.fillText;
    canvas_ctx.fillText2 = function( text, x_world, y_world, x_screen_offset, y_screen_offset ) {
      var xy = canvas_ctx.untransformedPoint(x_world, y_world);
      canvas_ctx.save();
      canvas_ctx.identity();
      fillText.call(canvas_ctx, text, xy.x + (x_screen_offset || 0), xy.y + (y_screen_offset || 0));
      canvas_ctx.restore();
    };

    var strokeText = canvas_ctx.strokeText;
    canvas_ctx.strokeText2 = function( text, x_world, y_world, x_screen_offset, y_screen_offset ) {
      var xy = canvas_ctx.untransformedPoint(x_world, y_world);
      canvas_ctx.save();
      canvas_ctx.identity();
      strokeText.call(canvas_ctx, text, xy.x + (x_screen_offset || 0), xy.y + (y_screen_offset || 0));
      canvas_ctx.restore();
    };

    var arc = canvas_ctx.arc;
    canvas_ctx.arc2 = function(x_world, y_world, radius_screen, startAngle, endAngle, counterclockwise) {
      var xy = canvas_ctx.untransformedPoint(x_world, y_world);
      canvas_ctx.save();
      canvas_ctx.identity();
      arc.call( canvas_ctx, xy.x, xy.y, radius_screen, startAngle, endAngle, counterclockwise );
      canvas_ctx.restore();
    };

    canvas_ctx.circle = function( x, y, radius ) {
      arc.call( canvas_ctx, x, y, radius, 0, Math.PI * 2 );
    };

    canvas_ctx.circle2 = function( x_world, y_world, radius_screen ) {
      var xy = canvas_ctx.untransformedPoint(x_world, y_world);
      canvas_ctx.save();
      canvas_ctx.identity();
      arc.call( canvas_ctx, xy.x, xy.y, radius_screen, 0, Math.PI * 2 );
      canvas_ctx.restore();
    };

    var rect = canvas_ctx.rect;
    canvas_ctx.rect2 = function(x_center_world, y_center_world, w_screen, h_screen) {
      var xy = canvas_ctx.untransformedPoint(x_center_world, y_center_world);
      canvas_ctx.save();
      canvas_ctx.identity();
      var r = rect.call( canvas_ctx, xy.x - w_screen/2, xy.y - h_screen/2, w_screen, h_screen );
      canvas_ctx.restore();
      return r;
    };

    function transformLength( l ){
      return l / canvas_ctx.getScale();
    }

    var stroke = canvas_ctx.stroke;
    canvas_ctx.stroke = function() {
      var lo = canvas_ctx.lineWidth;
      var l = transformLength( canvas_ctx.lineWidth );
      if( l < 0 ) l = -l;
      canvas_ctx.lineWidth = l;
      stroke.call(canvas_ctx);
      canvas_ctx.lineWidth = lo;
    };
    canvas_ctx.strokeAtScale = function() {
      stroke.call(canvas_ctx);
    };

    canvas_ctx.clear = function(fill_color, border_width, border_color){
      canvas_ctx.save();
      canvas_ctx.identity();
      if(fill_color){
        canvas_ctx.fillStyle = fill_color;
        canvas_ctx.fillRect(0,0,canvas_ctx.width, canvas_ctx.height);
      }else{
        canvas_ctx.clearRect(0,0,canvas_ctx.width, canvas_ctx.height);
      }
      if(border_width){
        canvas_ctx.lineWidth = border_width;
        if(border_color) canvas_ctx.strokeStyle = border_color;
        var h = border_width / 2.0;
        canvas_ctx.strokeRect(h, h, canvas_ctx.width - border_width, canvas_ctx.height - border_width);
      }
      canvas_ctx.restore();
    };

    return canvas_ctx;
  }

  ns.initCanvas = initCanvas;
  ns.enable_mouse_zoom = enable_mouse_zoom;
  ns.enable_pointer_input = enable_pointer_input;
  ns.track_transforms = track_transforms;
});
