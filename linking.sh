#!/bin/bash

files="Jazz2+.exe Anims.j2a Data.j2d English.j2s plus.dll"

for f in ${files}
do
	ln -s  "../../game/${f}"  "users/$1/${f}"
done