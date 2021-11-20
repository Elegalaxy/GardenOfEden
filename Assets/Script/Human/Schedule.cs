using System.Collections;
using System.Collections.Generic;
using UnityEngine;
public class Schedule : MonoBehaviour
{
    Timer TIME;
    void Start()
    {   
        //Getting the value from the Timer object.
        TIME = GameObject.FindWithTag("Timer").GetComponent<Timer>();
    }

    //Using to updating the schedules.
    //Building up the daily 24hrs rountine.
    void Update()
    {
        int temp = TIME.getTime();
        if (temp >= 0 && temp <= 7) // 0:00 am ~ 7:00 am sleeping time they would do nothing
        {
            Debug.Log("Human is Sleeping");
        }

        else if (temp > 7 && temp <= 8) // 7:00 am ~ 8:00 am is breakfast time
        {
            Debug.Log("Breakfast");
        }

        GameObject[] workplace = GameObject.FindGameObjectsWithTag("Maker");

    }

}
