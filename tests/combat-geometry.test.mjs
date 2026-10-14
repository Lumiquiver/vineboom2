import test from 'node:test';
import assert from 'node:assert/strict';
import { playerHitboxes, rayAabb, tracePlayer } from '../shared/combat-geometry.js';

const originAt=(y,z=-5)=>({x:0,y,z});
const forward={x:0,y:0,z:1};

test('standing hitboxes align to feet-origin player rig and body shots register',()=>{
  const boxes=playerHitboxes({x:0,y:0,z:0},'stand');
  const head=boxes.find(b=>b.head),torso=boxes.find(b=>b.part==='torso'),legs=boxes.find(b=>b.part==='legs');
  assert.ok(Math.abs((head.y+head.h/2)-1.745)<1e-9);
  assert.ok(Math.abs((torso.y+torso.h/2)-1.12)<1e-9);
  assert.ok(rayAabb(originAt(1.05),forward,torso,10)>0,'torso ray should intersect');
  assert.ok(rayAabb(originAt(.25),forward,legs,10)>0,'leg ray should intersect');
  assert.equal(tracePlayer(originAt(1.05),forward,{x:0,y:0,z:0},'stand')?.part,'torso');
  assert.equal(tracePlayer(originAt(1.75),forward,{x:0,y:0,z:0},'stand')?.head,true);
});

test('crouching, crawling, tripping, and stunned hitboxes follow rendered stances',()=>{
  const crouch=playerHitboxes({x:0,y:0,z:0},'crouch');
  const crawl=playerHitboxes({x:0,y:0,z:0},'crawl');
  const trip=playerHitboxes({x:0,y:0,z:0},'trip');
  const stunned=playerHitboxes({x:0,y:0,z:0},'stunned');
  assert.ok(crouch.find(b=>b.head).y>crawl.find(b=>b.head).y);
  assert.ok(rayAabb(originAt(.35),forward,crawl.find(b=>b.part==='torso'),10)>0);
  assert.ok(rayAabb(originAt(1.5),forward,trip.find(b=>b.head),10)>0);
  assert.ok(rayAabb(originAt(1.5),forward,stunned.find(b=>b.head),10)>0);
});

test('ray-AABB uses lower-face Y and respects max distance',()=>{
  const b={x:0,y:1,z:0,w:1,h:1,d:1};
  assert.equal(rayAabb({x:0,y:0,z:-3},forward,b,2),null);
  assert.equal(rayAabb({x:0,y:1.5,z:-3},forward,b,3),2.5);
  assert.equal(rayAabb({x:0,y:1.5,z:-3},forward,b,2),null);
});

import { rayGridCells } from '../shared/raycast-grid.js';

test('ray grid traversal visits thin collider cells, negative directions, and corner-touch cells',()=>{
  const straight=[...rayGridCells({x:1,y:1,z:1},{x:1,y:0,z:0},16,8)];
  assert.deepEqual(straight,[[0,0],[1,0],[2,0]]);
  const reverse=[...rayGridCells({x:17,y:1,z:1},{x:-1,y:0,z:0},16,8)];
  assert.deepEqual(reverse,[[2,0],[1,0],[0,0]]);
  const diagonal=[...rayGridCells({x:1,y:0,z:1},{x:Math.SQRT1_2,y:0,z:Math.SQRT1_2},14,8)];
  assert.ok(diagonal.some(([x,z])=>x===1&&z===0),'corner side X cell is included');
  assert.ok(diagonal.some(([x,z])=>x===0&&z===1),'corner side Z cell is included');
  assert.ok(diagonal.some(([x,z])=>x===1&&z===1),'diagonal cell is included');
});
