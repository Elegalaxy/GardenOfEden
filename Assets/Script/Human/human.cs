using System.Collections;
using System.Collections.Generic;

public class Human 
{
    static int id = 0;
    House home;
    Status status;

    public Human() { //Homeless
        id++;
        status = new Status();
    }
    public Human(House h) {
        id++;
        status = new Status();
        home = h;
    }

    //return status value for every human object
    public Status get_Stat() {
        return status;
    }

    //Home
    public void set_home(House h) {
        home = h;
    }

    public House get_home() {
        return home;
    }
}
