using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class Timer : MonoBehaviour
{
    float real = 0f;
    float now = 0f;
    int tmp = -1;
    float adminTime = 0f;

    float getNowTime(float t) { //1s in world = 720s in Eden
        return t*720;
    }

    public int getTime() {
        return ((int)(now / 3600));
    }
    void Update()
    {
        real += Time.deltaTime;

        if(real >= 120) {
            real = 0;
            Schedule.Reset();
        }
            

        now = getNowTime(real);

    }

    public void addTime() {
        real += 5;
        //Debug.Log((int) (getNowTime(real) / 3600));
    }
}
