using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class status : MonoBehaviour
{
    static int stamina = 100;
    static int starvation = 100;
    public int get_stamina()
    {
        return stamina;

    }

    public void set_stamina(int temp)
    {
        stamina = temp;
    }

    public int get_starvation()
    {
        return starvation;

    }

    public void set_starvation(int temp)
    {
        starvation = temp;
    }
}
