using System.Collections;
using System.Collections.Generic;

public class Status
{
    int stamina = 100;
    int starvation = 100;
    int money = 0;

    public Status() {
        stamina = 100;
        starvation = 100;
        money = 0;
    }

    public string get_print() {
        return "Stamina: " + stamina + " Starvation: " + starvation + " Money: " + money;
    }

    //Stamina
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

    //Starvation
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

    //Money
    public int get_money() {
        return money;

    }

    public void set_money(int temp) {
        money = temp;
    }

    public void change_money(int temp) {
        money += temp;
    }
}
