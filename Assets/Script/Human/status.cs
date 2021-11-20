using System.Collections;
using System.Collections.Generic;

public class Status
{
    int stamina = 100;
    int starvation = 100;

    public Status() {
        stamina = 100;
        starvation = 100;
    }

    public int get_stamina()
    {
        return stamina;

    }

    public void set_stamina(int temp)
    {
        stamina = temp;
    }

    public void change_stamina(int temp) {
        stamina += temp;
    }

    public int get_starvation()
    {
        return starvation;

    }

    public void set_starvation(int temp)
    {
        starvation = temp;
    }

    public void change_starvation(int temp) {
        starvation += temp;
    }

}
