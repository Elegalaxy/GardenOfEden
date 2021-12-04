using System.Collections;
using System.Collections.Generic;
using UnityEngine;
public class Schedule : MonoBehaviour
{
    public House home;

    Timer TIME;
    Human human;
    static bool check1 = true, check2 = true, check3 = true;
    bool isLock = false; //Lock action if currently doing something

    int prevTime = -1;

    void Start()
    {
        //Getting the value from the Timer object.
        TIME = GameObject.FindWithTag("Timer").GetComponent<Timer>();
        human = new Human(home);
    }

    //Using to updating the schedules.
    //Building up the daily 24hrs rountine.
    void Update()
    {
        int temp = TIME.getTime();
        if(prevTime != temp) {
            prevTime = temp;
            human.get_Stat().change_starvation(-3);
        }

        if(temp >= 0 && temp <= 7) // 0:00 am ~ 7:00 am sleeping time they would do nothing
        {
            if(check3) {
                check3 = false;
                home.sleep(human.get_Stat());
                Debug.Log(TIME.getTime());
                Debug.Log("Sleep");
                Debug.Log(human.get_Stat().get_print());
            }
        }

        else if (temp > 7 && temp <= 8) // 7:00 am ~ 8:00 am is breakfast time
        {
            GameObject[] restaurant = GameObject.FindGameObjectsWithTag("Seller");

            if(check1) {
                check1 = false;
                Debug.Log(TIME.getTime());
                Item item = restaurant[0].GetComponent<Building>().get_maker().service(human.get_Stat());
                Debug.Log(human.get_Stat().get_print());
                if(item != null) {
                    Debug.Log(item.get_obj().get_type());
                    if(item.get_obj().get_type() == "Food") {
                        human.get_Stat().change_starvation(item.get_obj().get_usage());
                    }
                } else Debug.Log("Null");
                Debug.Log(human.get_Stat().get_print());
            }
        }
        else if (temp > 8 && temp < 17)
        {
            GameObject[] workplace = GameObject.FindGameObjectsWithTag("Firm");

            if(check2) {
                check2 = false;
                Debug.Log(TIME.getTime());
                int sal = workplace[0].GetComponent<Building>().get_maker().work(human.get_Stat());
                human.get_Stat().change_money(sal);
                Debug.Log("Name: " + workplace[0].GetComponent<Building>().name + ", Salary: " + sal);
                Debug.Log(human.get_Stat().get_print());
            }

        }

        else if(temp >=17 && temp < 24)
        {
            //Debug.Log("Free Time");
        }

    }

    public static void Reset() {
        check1 = true;
        check2 = true;
        check3 = true;
    }

}
