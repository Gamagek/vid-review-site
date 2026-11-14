"""Mix dialogue, handmade Foley, and a quiet original music cue."""
from pathlib import Path
import subprocess, wave, json
import numpy as np
s=json.loads(Path('scene.json').read_text())
sr=24000;t=np.arange(round(sr*s['duration']))/sr
rng=np.random.default_rng(44);mix=np.zeros((len(t),2));noise=rng.normal(0,1,len(t))
def pan(samples,p):
 mix[:,0]+=samples*np.sqrt((1-p)/2);mix[:,1]+=samples*np.sqrt((1+p)/2)
def wav(name,start,length,panpos,level):
 raw=subprocess.check_output(['ffmpeg','-v','error','-i',name,'-ar',str(sr),'-ac','1','-f','f32le','-'])
 y=np.frombuffer(raw,np.float32).copy()
 active=np.flatnonzero(abs(y)>.018)
 if not len(active):raise ValueError('Silent input '+name)
 y=y[max(0,active[0]-int(.055*sr)):min(len(y),active[-1]+int(.12*sr))]
 if length:y=y[:int(length*sr)]
 y*=level/max(.001,np.max(abs(y)));n=min(len(y),int(.035*sr));y[-n:]*=np.linspace(1,0,n)
 a=np.zeros(len(t));i=int(start*sr);l=min(len(y),len(a)-i);a[i:i+l]=y[:l];pan(a,panpos)
for at in [1.63,2.95,6.55,10.4]:
 u=t-at;v=np.maximum(0,u);env=np.sin(np.pi*np.clip(v/.95,0,1))**2
 sig=np.sin(2*np.pi*(79*v+6*v*v)+1.8*np.sin(2*np.pi*31*v))
 pan(.14*env*(sig+.37*noise),.48)
for at,f in [(0,293.66),(.35,369.99),(.75,440),(1.12,554.37),(11.8,440),(12.15,369.99),(12.65,293.66)]:
 v=np.maximum(0,t-at);env=(1-np.exp(-v*75))*np.exp(-v*2.6)*(t>=at)
 pan(.105*env*(np.sin(2*np.pi*f*v)+.25*np.sin(2*np.pi*2.01*f*v)),0)
wav('audio/lead.wav',s['leadAt'],None,-.27,.63)
wav('audio/reply.wav',s['replyAt'],None,.34,.61)
if Path('audio/bark.wav').exists():wav('audio/bark.wav',5.95,.55,-.22,.19)
mix*=np.clip((s['duration']-t)/.4,0,1)[:,None]
with wave.open('build/mix.wav','wb') as f:
 f.setparams((2,2,sr,0,'NONE',''));f.writeframes((np.clip(mix,-.96,.96)*32767).astype('<i2').tobytes())
