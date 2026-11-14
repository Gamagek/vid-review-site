import {makeScene2D, Rect, Txt} from '@revideo/2d';
import {all, tween, waitFor} from '@revideo/core';
import story from '../scene.json';
export default makeScene2D('Midnight lettering', function* (view) {
  const addText = (text:string, size:number, y:number, color:string, weight=700) => {
    const label=new Txt({text,fontFamily:'DejaVu Sans',fontSize:size,fontWeight:weight,fill:color,y});
    view.add(label);return label;
  };
  const plate=new Rect({width:960,height:540,fill:'#121729'});view.add(plate);
  const overline=addText('V I D B E S T     /     M I D N I G H T   S H O R T S',15,-60,'#e9ba78');
  const title=addText(story.title,68,0,'#fff2d9');
  const sub=addText('a bedtime misunderstanding',22,67,'#bdc4dc',400);
  yield* waitFor(1.35);
  yield* all(...[plate,overline,title,sub].map(item=>item.opacity(0,.35)));
  const line=new Rect({width:470,height:58,y:209,radius:13,fill:'#151a30',opacity:0});view.add(line);
  const subtitle=addText(story.lead,29,209,'#fff2d9');subtitle.opacity(0);
  yield* waitFor(story.leadAt-1.7);
  yield* all(line.opacity(1,.12),subtitle.opacity(1,.12));yield* waitFor(1.63);
  yield* all(line.opacity(0,.12),subtitle.opacity(0,.12));
  yield* waitFor(story.replyAt-story.leadAt-1.87);
  subtitle.text(story.reply);
  yield* all(line.opacity(1,.12),subtitle.opacity(1,.12));yield* waitFor(2.0);
  yield* all(line.opacity(0,.12),subtitle.opacity(0,.12));
  yield* waitFor(1.45);
  title.text('It was not thunder.'); title.fontSize(48);sub.text('MIDNIGHT SHORTS   •   01');sub.fontSize(16);
  yield* all(plate.opacity(1,.28),title.opacity(1,.28),sub.opacity(1,.28));yield* waitFor(2);
});
