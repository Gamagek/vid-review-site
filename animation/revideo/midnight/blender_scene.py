"""CPU render a textured cutout mesh, preserving the supplied illustration."""
import bpy, json, math, sys
from pathlib import Path
root=Path(__file__).resolve().parent
s=json.loads((root/'scene.json').read_text())
out=root/'build';out.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
sc.render.engine='CYCLES';sc.cycles.device='CPU';sc.cycles.samples=1
sc.cycles.use_denoising=False;sc.view_settings.view_transform='Standard'
sc.render.resolution_x=s['width'];sc.render.resolution_y=s['height'];sc.render.resolution_percentage=100
sc.render.fps=s['fps'];sc.frame_start=1;sc.frame_end=int(s['duration']*s['fps'])
# Normalized drawing coordinates; localized shape keys move both faces independently.
nx,ny=96,54
vertices=[(x/nx*16-8,4.5-y/ny*9,0) for y in range(ny+1) for x in range(nx+1)]
faces=[]
for y in range(ny):
 for x in range(nx):
  i=y*(nx+1)+x;faces.append((i,i+nx+1,i+nx+2,i+1))
mesh=bpy.data.meshes.new('Room illustration mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
room=bpy.data.objects.new('Moonlit room',mesh);sc.collection.objects.link(room)
uv=mesh.uv_layers.new()
for l in mesh.loops:
 x,y,_=vertices[l.vertex_index];uv.data[l.index].uv=((x+8)/16,(y+4.5)/9)
mat=bpy.data.materials.new('Original ink and moonlight');mat.use_nodes=True
n=mat.node_tree.nodes;links=mat.node_tree.links
img=n.new('ShaderNodeTexImage');img.image=bpy.data.images.load(str(root/'public/bedroom.png'));img.image.pack()
em=n.new('ShaderNodeEmission');links.new(img.outputs['Color'],em.inputs[0]);links.new(em.outputs[0],n.get('Material Output').inputs[0]);mesh.materials.append(mat)
room.shape_key_add(name='Original')
def deform(name,cx,cy,rx,ry,dx,dy):
 key=room.shape_key_add(name=name);key.slider_min=-1
 for i,(x,y,z) in enumerate(vertices):
  u,v=(x+8)/16,(4.5-y)/9
  weight=math.exp(-2*((u-cx)/rx)**2-2*((v-cy)/ry)**2)
  key.data[i].co=(x+dx*weight,y+dy*weight,z)
 return key
breath=deform('Breathing',.706,.567,.117,.168,.018,.16)
flinch=deform('Startled reaction',.312,.412,.112,.19,-.15,.18)
mouth=deform('Sleeper jaw',.7,.573,.035,.038,.009,-.085)
speak=deform('Nightcap jaw',.32,.466,.04,.038,0,-.065)
bpy.ops.object.camera_add(location=(0,0,5));cam=bpy.context.object;cam.rotation_euler=(0,0,0);cam.data.type='ORTHO';sc.camera=cam
for f in range(1,sc.frame_end+1):
 t=(f-1)/s['fps'];snore=(1+math.sin(t*2.75))/2
 for k,val in [(breath,snore),(mouth,snore if t<7.8 or t>10.2 else abs(math.sin(t*14))),(flinch,math.exp(-((t-3.6)/.38)**2)+.3*math.exp(-((t-8.1)/.6)**2)),(speak,abs(math.sin(t*13))*float(4.2<t<5.55))]:
  k.value=val;k.keyframe_insert('value',frame=f)
 # Smooth optical push toward each speaker, with a wide establishing and final shot.
 left=math.exp(-((t-4.8)/2.05)**4);right=math.exp(-((t-8.8)/1.75)**4)
 cam.data.ortho_scale=15.85-3.3*left-3.1*right
 cam.location.x=-1.25*left+1.2*right;cam.location.y=.08*left
 cam.data.keyframe_insert('ortho_scale',frame=f);cam.keyframe_insert('location',frame=f)
sc.frame_set(1);sc.render.filepath=str(out/'room_')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'Thunder_Again.blend'))
bpy.ops.render.render(animation=True)
